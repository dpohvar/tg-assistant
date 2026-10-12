param([string]$NodePath, [string]$ProbePath, [string]$OutputDir, [int]$LimitMiB = 128)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WidgetJobProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Basic {
  public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorking, MaxWorking;
  public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority, Scheduling;
 }
 [StructLayout(LayoutKind.Sequential)] public struct Io {
  public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
 }
 [StructLayout(LayoutKind.Sequential)] public struct Extended {
  public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
 }
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr attrs, string name);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref Extended info, uint size);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job, int cls, out Extended info, uint size, IntPtr returned);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr handle);
}
'@
$job = [WidgetJobProbe]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { throw 'CreateJobObject failed' }
$probeProcess = $null
try {
 $info = New-Object WidgetJobProbe+Extended
 $basic = New-Object WidgetJobProbe+Basic
 $basic.Flags = 0x200 -bor 0x2000 # JOB_MEMORY + KILL_ON_JOB_CLOSE
 $info.Basic = $basic
 $info.JobMemory = [UIntPtr]::new([uint64]($LimitMiB * 1024 * 1024))
 $size = [Runtime.InteropServices.Marshal]::SizeOf($info)
 if (![WidgetJobProbe]::SetInformationJobObject($job, 9, [ref]$info, $size)) { throw "SetInformation failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
 # Probe waits 1 second before allocating. Production needs suspended creation/assignment.
 $probeProcess = Start-Process -FilePath $NodePath -ArgumentList @('--max-old-space-size=64', $ProbePath, 'buffers', '1000') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $OutputDir 'job-stdout.txt') -RedirectStandardError (Join-Path $OutputDir 'job-stderr.txt')
 if (![WidgetJobProbe]::AssignProcessToJobObject($job, $probeProcess.Handle)) { throw "Assign failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
 if (!$probeProcess.WaitForExit(15000)) { $probeProcess.Kill(); throw 'Probe timed out' }
 $measured = New-Object WidgetJobProbe+Extended
 if (![WidgetJobProbe]::QueryInformationJobObject($job, 9, [ref]$measured, $size, [IntPtr]::Zero)) { throw 'Query failed' }
 [pscustomobject]@{ limitMiB=$measured.JobMemory.ToUInt64()/1MB; flags=$measured.Basic.Flags; peakJobCommitMiB=$measured.PeakJobMemory.ToUInt64()/1MB; assigned=$true; exitCode=$probeProcess.ExitCode; stdout=[string](Get-Content (Join-Path $OutputDir 'job-stdout.txt') -Raw); stderr=[string](Get-Content (Join-Path $OutputDir 'job-stderr.txt') -Raw) } | ConvertTo-Json -Depth 4
} finally {
 [void][WidgetJobProbe]::CloseHandle($job)
 if ($probeProcess -and !$probeProcess.HasExited) { $probeProcess.Kill() }
}
