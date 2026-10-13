# Parks a real-browser window over Bot Bubble's card on Windows. winpark.js writes
# this file out and feeds it "show <pid> <x> <y> <w> <h>" / "hide <pid>" lines.
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class Park {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int a, ref int v, int size);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] static extern int GetSystemMetricsForDpi(int i, uint dpi);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr h, IntPtr rgn, bool redraw);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int l, int t, int r, int b, int w, int h);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);

  static readonly Dictionary<uint, IntPtr> windows = new Dictionary<uint, IntPtr>();

  // The browser's top-level window, waiting up to 15s for it to appear after launch.
  static IntPtr Find(uint pid) {
    IntPtr hwnd;
    if (windows.TryGetValue(pid, out hwnd) && IsWindow(hwnd)) return hwnd;
    for (int i = 0; i < 150; i++) {
      IntPtr hit = IntPtr.Zero;
      EnumWindows((w, l) => {
        uint p;
        GetWindowThreadProcessId(w, out p);
        if (p != pid || !IsWindowVisible(w) || GetWindowTextLength(w) == 0) return true;
        var cls = new StringBuilder(64);
        GetClassName(w, cls, 64);
        if (cls.ToString() != "Chrome_WidgetWin_1") return true;
        hit = w;
        return false;
      }, IntPtr.Zero);
      if (hit != IntPtr.Zero) { windows[pid] = hit; return hit; }
      Thread.Sleep(100);
    }
    return IntPtr.Zero;
  }

  // Size the window so its title bar and invisible borders fall just outside the
  // card, then clip it to the card with rounded corners. x, y, w, h are physical px.
  public static void Show(uint pid, int x, int y, int w, int h) {
    IntPtr hwnd = Find(pid);
    if (hwnd == IntPtr.Zero) return;
    // No DWM border or shadow; they'd show around the clipped window.
    int off = 1; /* DWMNCRP_DISABLED */
    DwmSetWindowAttribute(hwnd, 2 /* DWMWA_NCRENDERING_POLICY */, ref off, 4);
    // Chrome's page starts at its client area: that inset hides its 1px border too.
    RECT win, client;
    GetWindowRect(hwnd, out win);
    GetClientRect(hwnd, out client);
    var origin = new POINT();
    ClientToScreen(hwnd, ref origin);
    int left = origin.X - win.L, right = win.R - (origin.X + client.R), bottom = win.B - (origin.Y + client.B);
    uint dpi = GetDpiForWindow(hwnd);
    // SM_CYSIZEFRAME + SM_CXPADDEDBORDER + SM_CYCAPTION: the title bar Chrome draws.
    int top = GetSystemMetricsForDpi(33, dpi) + GetSystemMetricsForDpi(92, dpi) + GetSystemMetricsForDpi(4, dpi);
    int round = (int)(36 * dpi / 96);
    // A tool window gets no taskbar button. The taskbar only notices while it's hidden.
    long ex = GetWindowLongPtr(hwnd, -20 /* GWL_EXSTYLE */).ToInt64();
    if ((ex & 0x80 /* WS_EX_TOOLWINDOW */) == 0) {
      ShowWindow(hwnd, 0 /* SW_HIDE */);
      SetWindowLongPtr(hwnd, -20, new IntPtr((ex | 0x80) & ~0x40000L /* WS_EX_APPWINDOW */));
    }
    ShowWindow(hwnd, 4 /* SW_SHOWNOACTIVATE */);
    SetWindowPos(hwnd, new IntPtr(-1) /* HWND_TOPMOST */, x - left, y - top, w + left + right, h + top + bottom, 0x0010 /* SWP_NOACTIVATE */);
    SetWindowRgn(hwnd, CreateRoundRectRgn(left, top, left + w + 1, top + h + 1, round, round), true);
  }

  public static void Hide(uint pid) {
    IntPtr hwnd;
    if (windows.TryGetValue(pid, out hwnd) && IsWindow(hwnd)) ShowWindow(hwnd, 0 /* SW_HIDE */);
  }
}
"@

[Park]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null # per-monitor v2: real pixels
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $a = $line.Split(' ')
  try {
    if ($a[0] -eq 'show') { [Park]::Show([uint32]$a[1], [int]$a[2], [int]$a[3], [int]$a[4], [int]$a[5]) }
    elseif ($a[0] -eq 'hide') { [Park]::Hide([uint32]$a[1]) }
  } catch { [Console]::Error.WriteLine($_) }
}
