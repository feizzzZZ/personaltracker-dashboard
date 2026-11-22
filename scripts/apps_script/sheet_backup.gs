/**
 * Finance OS — weekly backup of your Google Sheet into your own Google Drive (v92)
 *
 * Why: since v86 the app writes to the sheet directly (add / edit / delete rows). A wrong delete can still be
 * undone from File → Version history, but that is hard to find and has no fixed "last Sunday" copy to compare with.
 * This keeps a full copy every week in a Drive folder that only you can see.
 *
 * It runs inside Google (Apps Script, under your own account). Nothing goes to GitHub — the repo is public,
 * so backups must never be committed there.
 *
 * Set up once (about 2 minutes):
 *   1. Open your Finance OS spreadsheet → Extensions → Apps Script
 *   2. Delete what is in Code.gs, paste this whole file, press Save (💾)
 *   3. In the function menu at the top choose  installWeeklyBackup  → Run
 *   4. Google asks for permission (Drive + this spreadsheet) → choose your account → Allow
 *      ("Google hasn't verified this app" → Advanced → Go to … — it is your own script)
 *   Done: one copy is made right away, then every Sunday around 03:00 in the script's time zone.
 *
 * Copies go to the Drive folder "Finance OS backups" (created if missing); the newest KEEP copies are kept,
 * older ones go to the Drive trash. To stop: run  uninstallWeeklyBackup.  To copy now: run  backupNow.
 * Restore: open a backup copy → right-click the tab you need → Copy to → your spreadsheet (or use File → Make a copy).
 */

const BACKUP_FOLDER = 'Finance OS backups';
const KEEP = 12;                 // newest 12 weekly copies ≈ 3 months
const MARK = ' — backup ';       // only files with this in the name are ever trashed by prune_

function backupNow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const folder = getFolder_();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + MARK + stamp, folder);
  prune_(folder);
}

function installWeeklyBackup() {
  uninstallWeeklyBackup();
  ScriptApp.newTrigger('backupNow').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  backupNow();
}

function uninstallWeeklyBackup() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'backupNow')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
}

function prune_(folder) {
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(MARK) > 0) files.push(f);
  }
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  files.slice(KEEP).forEach(f => f.setTrashed(true));
}
