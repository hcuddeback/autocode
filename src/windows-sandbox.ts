/** Trusted native host code. AppContainer restricts broker and process access;
 * the Job Object remains responsible for descendant lifetime. */
export const WINDOWS_SANDBOX = String.raw`
public sealed class AutoCodeSandbox : IDisposable {
  [StructLayout(LayoutKind.Sequential)] public struct StartupEx { public AutoCodeQaJob.StartupInfo Info; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct Capabilities { public IntPtr Sid, CapabilitiesPointer; public uint Count, Reserved; }
  [StructLayout(LayoutKind.Sequential)] struct SidAttributes { public IntPtr Sid; public uint Attributes; }
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int CreateAppContainerProfile(string name,string display,string description,IntPtr capabilities,uint count,out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int DeriveAppContainerSidFromAppContainerName(string name,out IntPtr sid);
  [DllImport("userenv.dll", CharSet=CharSet.Unicode)] static extern int GetAppContainerFolderPath(string sid,out IntPtr path);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode,SetLastError=true)] static extern bool ConvertStringSidToSid(string text,out IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  readonly string name;
  readonly string manifest;
  readonly System.Collections.Generic.List<string> boundaries=new System.Collections.Generic.List<string>();
  readonly System.Collections.Generic.List<string> grants=new System.Collections.Generic.List<string>();
  IntPtr sid, internet, capabilities, capabilityArray;
  SecurityIdentifier identity;
  public IntPtr Attributes;
  public IntPtr EnvironmentBlock;
  public string Command;
  static void Check(bool value) { if(!value) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  public AutoCodeSandbox(string profile,string cwd,string command,string runtime,string[] readFiles,string[] writeDirectories,string[] protectedResources,string ioDirectory,string[] blockedCredentials) {
    name=profile; manifest=Path.Combine(ioDirectory,"acl-targets");
    try {
      Marshal.ThrowExceptionForHR(CreateAppContainerProfile(name,name,"AutoCode isolated command",IntPtr.Zero,0,out sid));
      identity=new SecurityIdentifier(sid);
      IntPtr folder;
      Marshal.ThrowExceptionForHR(GetAppContainerFolderPath(identity.Value,out folder));
      string cache; try { cache=Marshal.PtrToStringUni(folder); } finally { Marshal.FreeCoTaskMem(folder); }
      Command=command;
      Grant(cwd,true,true);
      foreach(string directory in writeDirectories) Grant(directory,true,true);
      // Executable selection authorizes this file, never its parent directory.
      // Additional runtime resources require explicit trusted-host authorization.
      try { Grant(command,false,false); } catch(UnauthorizedAccessException) {
        if(!command.StartsWith(Environment.GetFolderPath(Environment.SpecialFolder.Windows)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) {
          string bin=Path.Combine(cache,"bin"); Directory.CreateDirectory(bin);
          Command=Path.Combine(bin,Path.GetFileName(command)); File.Copy(command,Command,false);
        }
      }
      foreach(string file in readFiles) Grant(file,false,Directory.Exists(file));
      foreach(string resource in protectedResources) ProtectMetadata(resource,true);
      foreach(string credential in blockedCredentials) ProtectMetadata(credential,false);
      // Package-manager shims need an AppContainer-readable Node installation.
      string runtimeBin=Path.Combine(cache,"runtime"); Directory.CreateDirectory(runtimeBin);
      string node=Path.Combine(runtimeBin,Path.GetFileName(runtime)); File.Copy(runtime,node,false);
      Environment.SetEnvironmentVariable("AUTOCODE_NODE",node);
      Environment.SetEnvironmentVariable("PATH",runtimeBin+";"+Environment.GetEnvironmentVariable("PATH"));
      Environment.SetEnvironmentVariable("NODE_OPTIONS","--preserve-symlinks --preserve-symlinks-main");
      Environment.SetEnvironmentVariable("TEMP",cache); Environment.SetEnvironmentVariable("TMP",cache);
      // Never inherit the operator's token/provider/proxy/home environment.
      var environment=new System.Collections.Generic.SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(string key in new string[]{"SystemRoot","WINDIR","COMSPEC","PATH","PATHEXT","OS","NUMBER_OF_PROCESSORS","PROCESSOR_ARCHITECTURE","AUTOCODE_NODE","NODE_OPTIONS","TEMP","TMP"}) {
        string value=Environment.GetEnvironmentVariable(key); if(value!=null) environment[key]=value;
      }
      environment["USERPROFILE"]=cache; environment["APPDATA"]=cache; environment["LOCALAPPDATA"]=cache; environment["HOME"]=cache;
      var environmentText=new StringBuilder(); foreach(var entry in environment) environmentText.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
      environmentText.Append('\0'); EnvironmentBlock=Marshal.StringToHGlobalUni(environmentText.ToString());
      Check(ConvertStringSidToSid("S-1-15-3-1",out internet)); // internetClient only; no broker-management capabilities.
      capabilityArray=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SidAttributes)));
      Marshal.StructureToPtr(new SidAttributes { Sid=internet,Attributes=4 },capabilityArray,false);
      capabilities=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Capabilities)));
      Marshal.StructureToPtr(new Capabilities { Sid=sid,CapabilitiesPointer=capabilityArray,Count=1 },capabilities,false);
      IntPtr size=IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
      Attributes=Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(Attributes,1,0,ref size));
      Check(UpdateProcThreadAttribute(Attributes,0,new IntPtr(0x20009),capabilities,new IntPtr(Marshal.SizeOf(typeof(Capabilities))),IntPtr.Zero,IntPtr.Zero));
    } catch { Dispose(); throw; }
  }
  void Grant(string target,bool write,bool inherit) {
    bool directory=Directory.Exists(target);
    if(!write) {
      FileSystemSecurity current=directory ? (FileSystemSecurity)Directory.GetAccessControl(target) : File.GetAccessControl(target);
      var descriptor=new RawSecurityDescriptor(current.GetSecurityDescriptorBinaryForm(),0);
      if(descriptor.DiscretionaryAcl!=null) foreach(GenericAce entry in descriptor.DiscretionaryAcl) {
        var allowed=entry as QualifiedAce;
        if(allowed!=null && allowed.AceQualifier==AceQualifier.AccessAllowed && allowed.SecurityIdentifier.Equals(identity) && (unchecked((uint)allowed.AccessMask)&0x500d0156u)!=0) {
          ProtectMetadata(target,true); return;
        }
      }
    }
    var rights=write ? FileSystemRights.Modify : FileSystemRights.ReadAndExecute;
    var inheritance=directory && inherit ? InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit : InheritanceFlags.None;
    var rule=new FileSystemAccessRule(identity,rights,inheritance,PropagationFlags.None,AccessControlType.Allow);
    if(directory) { var acl=Directory.GetAccessControl(target); acl.AddAccessRule(rule); Directory.SetAccessControl(target,acl); }
    else { var acl=File.GetAccessControl(target); acl.AddAccessRule(rule); File.SetAccessControl(target,acl); }
    grants.Add(target); File.AppendAllText(manifest,target+Environment.NewLine);
  }
  void CheckMetadataPackageAccess(string target) {
    var pending=new System.Collections.Generic.Stack<string>(); pending.Push(target); int visited=1;
    while(pending.Count>0) {
      string entry=pending.Pop();
      bool directory=Directory.Exists(entry); if(!directory && !File.Exists(entry)) continue;
      if((File.GetAttributes(entry)&FileAttributes.ReparsePoint)!=0) throw new InvalidOperationException("protected metadata must not contain links");
      FileSystemSecurity acl=directory ? (FileSystemSecurity)Directory.GetAccessControl(entry) : File.GetAccessControl(entry);
      var descriptor=new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(),0);
      if(descriptor.DiscretionaryAcl==null) throw new InvalidOperationException("sandbox resources must have a restrictive ACL");
      foreach(GenericAce ace in descriptor.DiscretionaryAcl) {
        var allowed=ace as QualifiedAce;
        // File/directory write, append, delete, ACL ownership and generic write/all.
        if(allowed!=null && allowed.AceQualifier==AceQualifier.AccessAllowed && !allowed.SecurityIdentifier.Equals(identity) && allowed.SecurityIdentifier.Value.StartsWith("S-1-15-",StringComparison.Ordinal) && (unchecked((uint)allowed.AccessMask)&0x500d0156u)!=0)
          throw new InvalidOperationException("metadata ACL already grants application-package write access; operator hardening is required before launch");
      }
      if(directory) foreach(string child in Directory.EnumerateFileSystemEntries(entry)) { if(++visited>100000) throw new InvalidOperationException("metadata ACL inspection exceeds its entry limit"); pending.Push(child); }
    }
  }
  void ProtectMetadata(string target,bool readable) {
    bool directory=Directory.Exists(target); if(!directory && !File.Exists(target)) return;
    FileSystemSecurity acl=directory ? (FileSystemSecurity)Directory.GetAccessControl(target) : File.GetAccessControl(target);
    if(readable) CheckMetadataPackageAccess(target);
    var before=new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(),0);
    if(before.DiscretionaryAcl==null) throw new InvalidOperationException("sandbox resources must have a restrictive ACL");
    // Never remove and later reconstruct an operator's package grants. Such
    // reconstruction cannot distinguish our removals from concurrent hardening.
    if(!readable) foreach(GenericAce entry in before.DiscretionaryAcl) {
      var allowed=entry as QualifiedAce;
      if(allowed!=null && allowed.AceQualifier==AceQualifier.AccessAllowed && !allowed.SecurityIdentifier.Equals(identity) && allowed.SecurityIdentifier.Value.StartsWith("S-1-15-",StringComparison.Ordinal))
        throw new InvalidOperationException("credential ACL already grants application-package access; operator hardening is required before launch");
    }
    string original=Convert.ToBase64String(acl.GetSecurityDescriptorBinaryForm());
    acl.SetAccessRuleProtection(true,true);
    // PurgeAccessRules does not remove inherited ACEs. Convert retained entries
    // explicitly and remove every grant for this launch before adding read access.
    var descriptor=new RawSecurityDescriptor(acl.GetSecurityDescriptorBinaryForm(),0);
    for(int index=descriptor.DiscretionaryAcl.Count-1;index>=0;index--) {
      var known=descriptor.DiscretionaryAcl[index] as KnownAce;
      if(known!=null && known.SecurityIdentifier.Equals(identity)) descriptor.DiscretionaryAcl.RemoveAce(index);
      else descriptor.DiscretionaryAcl[index].AceFlags &= ~AceFlags.Inherited;
    }
    byte[] boundaryBytes=new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(boundaryBytes,0);
    acl.SetSecurityDescriptorBinaryForm(boundaryBytes,AccessControlSections.Access);
    var inheritance=directory ? InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit : InheritanceFlags.None;
    if(readable) acl.AddAccessRule(new FileSystemAccessRule(identity,FileSystemRights.ReadAndExecute,inheritance,PropagationFlags.None,AccessControlType.Allow));
    FileSystemSecurity expected=directory ? (FileSystemSecurity)new DirectorySecurity() : new FileSecurity();
    expected.SetSecurityDescriptorBinaryForm(acl.GetSecurityDescriptorBinaryForm());
    expected.PurgeAccessRules(identity);
    // Retain the exact boundary before applying it, for normal and crash cleanup.
    string record=target+"\t"+original+"\t"+Convert.ToBase64String(expected.GetSecurityDescriptorBinaryForm());
    File.AppendAllText(Path.Combine(Path.GetDirectoryName(manifest),"acl-boundaries"),record+Environment.NewLine);
    boundaries.Add(record);
    if(directory) Directory.SetAccessControl(target,(DirectorySecurity)acl); else File.SetAccessControl(target,(FileSecurity)acl);
    grants.Add(target); File.AppendAllText(manifest,target+Environment.NewLine);
  }
  static void RestoreBoundary(string record,SecurityIdentifier identity) {
    string[] fields=record.Split('\t'); string target=fields[0];
    bool directory=Directory.Exists(target); if(!directory && !File.Exists(target)) return;
    FileSystemSecurity original=directory ? (FileSystemSecurity)new DirectorySecurity() : new FileSecurity();
    original.SetSecurityDescriptorBinaryForm(Convert.FromBase64String(fields[1]));
    FileSystemSecurity current=directory ? (FileSystemSecurity)Directory.GetAccessControl(target) : File.GetAccessControl(target);
    current.PurgeAccessRules(identity);
    FileSystemSecurity expected=directory ? (FileSystemSecurity)new DirectorySecurity() : new FileSecurity();
    expected.SetSecurityDescriptorBinaryForm(Convert.FromBase64String(fields[2]));
    // Concurrent operator ACL replacements/removals remain authoritative. Do not
    // re-enable inheritance or reconstruct old entries over a changed boundary.
    bool unchanged=current.GetSecurityDescriptorSddlForm(AccessControlSections.Access)==expected.GetSecurityDescriptorSddlForm(AccessControlSections.Access);
    if(unchanged && !original.AreAccessRulesProtected && current.AreAccessRulesProtected) {
      // Remove only converted inherited entries, then adopt current parent ACLs.
      // Preserve unrelated explicit entries and concurrent operator ACL changes.
      foreach(FileSystemAccessRule rule in original.GetAccessRules(false,true,typeof(SecurityIdentifier))) {
        current.RemoveAccessRuleSpecific(new FileSystemAccessRule(rule.IdentityReference,rule.FileSystemRights,rule.InheritanceFlags,rule.PropagationFlags,rule.AccessControlType));
      }
      current.SetAccessRuleProtection(false,false);
    }
    if(directory) Directory.SetAccessControl(target,(DirectorySecurity)current); else File.SetAccessControl(target,(FileSecurity)current);
  }
  public void Dispose() {
    // Remove only this launch's SID, preserving other ACL entries and concurrent edits.
    foreach(string target in grants) {
      bool directory=Directory.Exists(target); if(!directory && !File.Exists(target)) continue;
      FileSystemSecurity acl=directory ? (FileSystemSecurity)Directory.GetAccessControl(target) : File.GetAccessControl(target);
      acl.PurgeAccessRules(identity);
      if(directory) Directory.SetAccessControl(target,(DirectorySecurity)acl); else File.SetAccessControl(target,(FileSecurity)acl);
    }
    grants.Clear();
    foreach(string record in boundaries) RestoreBoundary(record,identity); boundaries.Clear();
    if(Attributes!=IntPtr.Zero) { DeleteProcThreadAttributeList(Attributes); Marshal.FreeHGlobal(Attributes); Attributes=IntPtr.Zero; }
    if(capabilities!=IntPtr.Zero) { Marshal.FreeHGlobal(capabilities); capabilities=IntPtr.Zero; }
    if(capabilityArray!=IntPtr.Zero) { Marshal.FreeHGlobal(capabilityArray); capabilityArray=IntPtr.Zero; }
    if(EnvironmentBlock!=IntPtr.Zero) { Marshal.FreeHGlobal(EnvironmentBlock); EnvironmentBlock=IntPtr.Zero; }
    if(internet!=IntPtr.Zero) { LocalFree(internet); internet=IntPtr.Zero; }
    if(sid!=IntPtr.Zero) {
      RemoveProfile(name);
      FreeSid(sid); sid=IntPtr.Zero;
    }
  }
  public static void Cleanup(string name,string[] targets,string ioDirectory) {
    IntPtr sid; Marshal.ThrowExceptionForHR(DeriveAppContainerSidFromAppContainerName(name,out sid));
    try {
      var identity=new SecurityIdentifier(sid);
      var cleanupTargets=new System.Collections.Generic.List<string>(targets);
      string manifest=Path.Combine(ioDirectory,"acl-targets");
      if(File.Exists(manifest)) cleanupTargets.AddRange(File.ReadAllLines(manifest));
      foreach(string target in cleanupTargets) {
        bool directory=Directory.Exists(target); if(!directory && !File.Exists(target)) continue;
        FileSystemSecurity acl=directory ? (FileSystemSecurity)Directory.GetAccessControl(target) : File.GetAccessControl(target);
        bool found=false; foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,false,typeof(SecurityIdentifier))) if(rule.IdentityReference.Equals(identity)) found=true;
        if(!found) continue;
        acl.PurgeAccessRules(identity);
        if(directory) Directory.SetAccessControl(target,(DirectorySecurity)acl); else File.SetAccessControl(target,(FileSecurity)acl);
      }
      string boundaryManifest=Path.Combine(ioDirectory,"acl-boundaries");
      if(File.Exists(boundaryManifest)) foreach(string record in File.ReadAllLines(boundaryManifest)) RestoreBoundary(record,identity);
      RemoveProfile(name);
    } finally { FreeSid(sid); }
  }
  static void RemoveProfile(string name) {
    int result;
    for(int attempt=0;attempt<100;attempt++) {
      result=DeleteAppContainerProfile(name);
      if(result>=0 || result==unchecked((int)0x80070002)) return;
      if(result!=unchecked((int)0x80070005) && result!=unchecked((int)0x80070020)) Marshal.ThrowExceptionForHR(result);
      System.Threading.Thread.Sleep(50);
    }
    throw new InvalidOperationException("sandbox profile cleanup did not finish");
  }
}
`;
