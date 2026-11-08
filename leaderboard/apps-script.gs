/**
 * 《請問巧馨，今天要排擠誰?》排行榜後端 —— Google Apps Script
 *
 * 用法：在 Google 試算表 → 擴充功能 → Apps Script，把這整份貼上，
 *       再「部署 → 新增部署作業 → 網頁應用程式」（執行身分：我；存取權：所有人）。
 * 詳細步驟見同資料夾的「設定步驟.md」。
 *
 * 試算表第一個工作表會自動建立欄位：時間戳記 | 暱稱 | 難度 | 通關秒數 | 擊退數
 * 想刪掉不雅暱稱或可疑成績，直接刪除那一列即可。
 */

const MIN_TIME = 45;     // 通關秒數低於這個值視為不合理，不收
const MAX_TIME = 3600;
const TOP_N = 10;
const NAME_MAX = 12;

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sh.getLastRow() === 0) sh.appendRow(['時間戳記', '暱稱', '難度', '通關秒數', '擊退數']);
  return sh;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* 讀取排行榜：每種難度、每個暱稱只留最快的一次，取前 TOP_N 名 */
function board_() {
  const sh = sheet_(), n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, 5).getValues() : [];
  const out = { easy: [], hard: [] };
  for (const diff of ['easy', 'hard']) {
    const best = {};
    for (const r of rows) {
      const name = String(r[1]).replace(/^'/, ''), d = String(r[2]), time = Number(r[3]);
      if (d !== diff || !name || !(time > 0)) continue;
      if (!best[name] || time < best[name].time) best[name] = { name, time, kills: Number(r[4]) || 0, date: r[0] };
    }
    out[diff] = Object.values(best).sort((a, b) => a.time - b.time).slice(0, TOP_N)
      .map(e => ({ name: e.name, time: e.time, kills: e.kills, date: e.date instanceof Date ? Utilities.formatDate(e.date, 'Asia/Taipei', 'MM/dd') : '' }));
  }
  return out;
}

function doGet() {
  return json_({ ok: true, board: board_() });
}

/* 上傳成績：body 為 JSON 字串 {name, diff, time, kills} */
function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad json' }); }
  const name = String(d.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX);
  const diff = d.diff === 'hard' ? 'hard' : d.diff === 'easy' ? 'easy' : '';
  const time = Math.round(Number(d.time) * 10) / 10;
  const kills = Math.max(0, Math.min(9999, Math.floor(Number(d.kills) || 0)));
  if (!name) return json_({ ok: false, error: '請輸入暱稱' });
  if (!diff) return json_({ ok: false, error: 'bad diff' });
  if (!(time >= MIN_TIME && time <= MAX_TIME)) return json_({ ok: false, error: '成績不合理' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // 開頭加 ' 防止暱稱被試算表當成公式
    sheet_().appendRow([new Date(), "'" + name, diff, time, kills]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true, board: board_() });
}
