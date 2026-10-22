using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
// A dedicated unnamed job, assigned before any model input. Never identifies children by PID alone.
public class CodexOwner {
 [StructLayout(LayoutKind.Sequential)] struct Limits { public long processTime,jobTime;public uint flags;public UIntPtr minWorking,maxWorking;public uint active;public UIntPtr affinity;public uint priority,scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Limits limits;public IO io;public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long user,kernel,periodUser,periodKernel;public uint faults,total,active,terminated; }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attr,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Extended info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int kind,out Accounting info,uint length,IntPtr returned);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 public static void Main(){IntPtr job=IntPtr.Zero;try {
  string line;while((line=Console.ReadLine())!=null){
   if(line.StartsWith("own ")){if(job!=IntPtr.Zero)throw new Exception();using(var process=Process.GetProcessById(int.Parse(line.Substring(4)))){
    var handle=process.Handle;var start=process.StartTime.ToUniversalTime().Ticks;
    job=CreateJobObject(IntPtr.Zero,null);var info=new Extended();info.limits.flags=0x2000;
    if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref info,(uint)Marshal.SizeOf(info))||!AssignProcessToJobObject(job,handle))throw new Exception();
    Console.WriteLine("{\"owned\":true,\"start\":\""+start+"\"}");
   }}else if(line=="stop"){
    if(job==IntPtr.Zero||!TerminateJobObject(job,1))throw new Exception();bool empty=false;
    for(int i=0;i<200;i++){Accounting info;if(!QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero))throw new Exception();if(info.active==0){empty=true;break;}Thread.Sleep(25);}
    Console.WriteLine(empty?"{\"state\":\"interrupted\"}":"{\"state\":\"unknown\"}");
   }else throw new Exception();
  }
 }catch{Console.WriteLine("{\"state\":\"unknown\",\"code\":\"job_control_unavailable\"}");}finally{if(job!=IntPtr.Zero)CloseHandle(job);}}
}
