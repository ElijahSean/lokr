// Windows shell helpers shared by Start-Lokr.ps1, Install-LokrShortcut.ps1 and
// Test-LokrLauncher.ps1 (task 4.4). Loaded with Add-Type, so it stays C# 5:
// Windows PowerShell 5.1 compiles with the .NET Framework compiler.
//
// Chrome gives an --app window no AppUserModelID of its own, so the launcher
// labels the window itself and the installer writes the same ID onto Lokr.lnk.
// The window's relaunch values are what make it pinnable: Windows saves a
// pinned Lokr window as its own implicit shortcut when the window closes.
// Pinning Lokr.lnk itself is not recorded (task 4.5).
// Nothing here reads browser storage, profile files or page content.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace Lokr.Launcher {
  public static class LokrShell {
    // Port-specific so a throwaway test install never joins the real Lokr button.
    public static string AppId(int port) {
      return "Lokr.Desktop.Port" + port;
    }

    // A window property, not the AppUserModelID: Windows does not let another
    // process read the ID back, but a named property is visible to every process.
    public static string MarkerName(int port) {
      return "Lokr.AppWindow.Port" + port;
    }

    private delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maxCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool SetProp(IntPtr window, string name, IntPtr data);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetProp(IntPtr window, string name);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr window, int command);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr window);

    [DllImport("user32.dll")]
    private static extern bool FlashWindow(IntPtr window, bool invert);

    private const int SW_MINIMIZE = 6;
    private const int SW_RESTORE = 9;

    // Visible top-level windows owned by any of the given processes.
    public static long[] VisibleWindows(int[] processIds) {
      HashSet<uint> owners = new HashSet<uint>();
      foreach (int id in processIds) {
        owners.Add((uint)id);
      }
      List<long> windows = new List<long>();
      EnumWindows(delegate (IntPtr window, IntPtr parameter) {
        uint owner;
        GetWindowThreadProcessId(window, out owner);
        if (owners.Contains(owner) && IsWindowVisible(window)) {
          windows.Add(window.ToInt64());
        }
        return true;
      }, IntPtr.Zero);
      return windows.ToArray();
    }

    public static string WindowTitle(long window) {
      StringBuilder text = new StringBuilder(512);
      GetWindowText(new IntPtr(window), text, text.Capacity);
      return text.ToString();
    }

    // 0 when no labelled Lokr window for this port is open.
    public static long FindMarked(int[] processIds, int port) {
      string marker = MarkerName(port);
      foreach (long window in VisibleWindows(processIds)) {
        if (GetProp(new IntPtr(window), marker) != IntPtr.Zero) {
          return window;
        }
      }
      return 0;
    }

    public static bool IsMinimised(long window) {
      return IsIconic(new IntPtr(window));
    }

    // Used by the launcher tests to prove a minimised window is restored.
    public static void Minimise(long window) {
      ShowWindow(new IntPtr(window), SW_MINIMIZE);
    }

    // True when Windows allowed the window to the front. When it refuses
    // (foreground rules), the taskbar button flashes instead.
    public static bool BringForward(long window) {
      IntPtr handle = new IntPtr(window);
      if (IsIconic(handle)) {
        ShowWindow(handle, SW_RESTORE);
      }
      if (SetForegroundWindow(handle)) {
        return true;
      }
      FlashWindow(handle, true);
      return false;
    }

    // Gives the window Lokr's taskbar identity: ID, name, icon and the command
    // a pinned window runs. Relaunch values first; the ID last makes Windows
    // regroup the button with them in place. An empty command sets the ID only
    // (Windows caps each relaunch value below 256 characters).
    public static void Label(long window, int port, string relaunchCommand,
        string iconResource, string displayName) {
      IntPtr handle = new IntPtr(window);
      IPropertyStore store;
      Guid storeId = typeof(IPropertyStore).GUID;
      Check(SHGetPropertyStoreForWindow(handle, ref storeId, out store), "open the window properties");
      try {
        if (!String.IsNullOrEmpty(relaunchCommand)) {
          SetString(store, RelaunchCommandKey, relaunchCommand);
          SetString(store, RelaunchIconKey, iconResource);
          SetString(store, RelaunchNameKey, displayName);
        }
        SetString(store, AppIdKey, AppId(port));
        Check(store.Commit(), "save the window properties");
      } finally {
        Marshal.ReleaseComObject(store);
      }
      if (!SetProp(handle, MarkerName(port), new IntPtr(1))) {
        throw new InvalidOperationException("Windows refused to mark the Lokr window.");
      }
    }

    public static void SetShortcutAppId(string shortcutPath, string appId) {
      object link = new ShellLinkObject();
      try {
        IPersistFile file = (IPersistFile)link;
        file.Load(shortcutPath, 2); // STGM_READWRITE
        IPropertyStore store = (IPropertyStore)link;
        SetString(store, AppIdKey, appId);
        Check(store.Commit(), "save the shortcut's app ID");
        file.Save(shortcutPath, true);
      } finally {
        Marshal.ReleaseComObject(link);
      }
    }

    // Empty when the shortcut has no app ID (every shortcut before 4.4).
    public static string GetShortcutAppId(string shortcutPath) {
      object link = new ShellLinkObject();
      try {
        ((IPersistFile)link).Load(shortcutPath, 0); // STGM_READ
        IPropertyStore store = (IPropertyStore)link;
        PropertyKey key = AppIdKey;
        PropVariant value;
        Check(store.GetValue(ref key, out value), "read the shortcut's app ID");
        try {
          return value.vt == VT_LPWSTR ? Marshal.PtrToStringUni(value.pointer) : "";
        } finally {
          PropVariantClear(ref value);
        }
      } finally {
        Marshal.ReleaseComObject(link);
      }
    }

    private static void SetString(IPropertyStore store, PropertyKey key, string text) {
      PropVariant value = new PropVariant();
      value.vt = VT_LPWSTR;
      value.pointer = Marshal.StringToCoTaskMemUni(text);
      try {
        Check(store.SetValue(ref key, ref value), "set a shell property");
      } finally {
        Marshal.FreeCoTaskMem(value.pointer);
      }
    }

    private static void Check(int result, string action) {
      if (result != 0) {
        throw new InvalidOperationException(
          "Windows could not " + action + " (HRESULT 0x" + result.ToString("X8") + ").");
      }
    }

    // System.AppUserModel.* property keys (propkey.h).
    private static readonly Guid AppUserModelFormat = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private static PropertyKey Key(uint id) {
      PropertyKey key = new PropertyKey();
      key.formatId = AppUserModelFormat;
      key.propertyId = id;
      return key;
    }
    private static readonly PropertyKey RelaunchCommandKey = Key(2);
    private static readonly PropertyKey RelaunchIconKey = Key(3);
    private static readonly PropertyKey RelaunchNameKey = Key(4);
    private static readonly PropertyKey AppIdKey = Key(5);

    private const ushort VT_LPWSTR = 31;

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private struct PropertyKey {
      public Guid formatId;
      public uint propertyId;
    }

    // Full PROPVARIANT size (24 bytes on x64): GetValue writes the whole struct.
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    private struct PropVariant {
      [FieldOffset(0)] public ushort vt;
      [FieldOffset(8)] public IntPtr pointer;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),
      InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore {
      [PreserveSig] int GetCount(out uint count);
      [PreserveSig] int GetAt(uint index, out PropertyKey key);
      [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
      [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
      [PreserveSig] int Commit();
    }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLinkObject {
    }

    [DllImport("shell32.dll")]
    private static extern int SHGetPropertyStoreForWindow(IntPtr window, ref Guid interfaceId,
      out IPropertyStore store);

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant value);
  }
}
