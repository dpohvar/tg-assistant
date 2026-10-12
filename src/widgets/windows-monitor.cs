using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public class Monitor {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Auto)] struct Entry { public uint size,usage,pid; public IntPtr heap; public uint module,threads,ppid;public int priority;public uint flags;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)]public string name; }
 [DllImport("kernel32.dll")]static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
 [DllImport("kernel32.dll",CharSet=CharSet.Auto)]static extern bool Process32First(IntPtr snap,ref Entry e);
 [DllImport("kernel32.dll",CharSet=CharSet.Auto)]static extern bool Process32Next(IntPtr snap,ref Entry e);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr h);
 public static void Main(){string line;while((line=Console.ReadLine())!=null){if(line=="sample")Sample();else if(line.StartsWith("kill ")){var parts=line.Split(' ');try{var p=Process.GetProcessById(int.Parse(parts[1]));if(p.StartTime.ToUniversalTime().Ticks.ToString()==parts[2]){p.Kill();p.WaitForExit(2000);}p.Dispose();}catch{}Console.WriteLine("{\"killed\":"+parts[1]+"}");}}}
 static void Sample(){var b=new StringBuilder("[");var snap=CreateToolhelp32Snapshot(2,0);if(snap==new IntPtr(-1))Environment.Exit(2);var e=new Entry();e.size=(uint)Marshal.SizeOf(e);bool ok=Process32First(snap,ref e),first=true;while(ok){try{using(var p=Process.GetProcessById((int)e.pid)){var start=p.StartTime.ToUniversalTime().Ticks;long rss=p.WorkingSet64;if(!first)b.Append(',');first=false;b.Append("{\"pid\":"+e.pid+",\"ppid\":"+e.ppid+",\"start\":\""+start+"\",\"bytes\":"+rss+"}");}}catch{if(!first)b.Append(',');first=false;b.Append("{\"pid\":"+e.pid+",\"ppid\":"+e.ppid+",\"start\":null,\"bytes\":-1}");}ok=Process32Next(snap,ref e);}CloseHandle(snap);b.Append(']');Console.WriteLine(b.ToString());}
}
