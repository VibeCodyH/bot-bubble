// Windows: park a real-browser window over the bubble's card, the way browser.js
// does on Hyprland. A long-lived PowerShell process makes the user32 calls.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { screen } = require('electron');

let helper = null;

function send(dataDir, line) {
  if (!helper || helper.exitCode !== null) {
    // PowerShell can't read inside app.asar, so the script goes out to the data folder first.
    const script = path.join(dataDir, 'gen', 'winpark.ps1');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'winpark.ps1'), 'utf8'));
    helper = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    helper.stderr.on('data', (d) => console.error(`winpark: ${d}`.trim()));
    helper.on('error', (e) => console.error(`winpark: ${e.message}`));
    helper.unref();
  }
  helper.stdin.write(`${line}\n`);
}

// The profile is ours alone. A browser still running on it (say Bot Bubble crashed while
// it was hidden) would swallow the next launch, and we'd never find that window.
function closeProfile(dir) {
  const script = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('--user-data-dir=' + $env:BB_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { env: { ...process.env, BB_PROFILE: dir }, windowsHide: true }, () => resolve());
  });
}

module.exports = {
  closeProfile,
  show(dataDir, pid, bounds) {
    const b = screen.dipToScreenRect(null, bounds);
    send(dataDir, `show ${pid} ${b.x} ${b.y} ${b.width} ${b.height}`);
  },
  hide(dataDir, pid) { send(dataDir, `hide ${pid}`); },
};
