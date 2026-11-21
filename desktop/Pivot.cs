using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Xml.Linq;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Reflection;
[assembly: AssemblyTitle("Pivot robotics IDE")]
[assembly: AssemblyProduct("Pivot")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]

namespace PivotDesktop {
    internal static class Program {
        [STAThread]
        private static void Main(string[] args) {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try {
                string app = Path.GetFullPath(Option(args,"--app") ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"app"));
                string profile = Path.GetFullPath(Environment.GetEnvironmentVariable("PIVOT_DESKTOP_PROFILE") ??
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Pivot","user"));
                Directory.CreateDirectory(profile);
                string mutexName;
                using(var hash=SHA256.Create()) mutexName="Local\\PivotDesktop-"+BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(profile.ToUpperInvariant()))).Substring(0,32);
                bool first;
                using(var mutex=new Mutex(true,mutexName,out first)) {
                    if (!first) { MessageBox.Show("Pivot is already running for this profile.","Pivot"); return; }
                    Application.Run(new MainWindow(app,profile,Option(args,"--root")));
                }
            } catch(Exception ex) {
                MessageBox.Show(ex.Message,"Pivot startup",MessageBoxButtons.OK,MessageBoxIcon.Error);
                Environment.ExitCode=1;
            }
        }
        static string Option(string[] args,string name) {
            int index=Array.IndexOf(args,name);
            if(index<0) return null;
            if(index+1>=args.Length) throw new ArgumentException("A path is required after "+name+".");
            return args[index+1];
        }
    }

    // The OS closes every remaining Node, terminal and simulation child if the host disappears.
    internal sealed class ProcessJob : IDisposable {
        [StructLayout(LayoutKind.Sequential)] struct Basic {
            public long ProcessTime,JobTime; public uint LimitFlags; public UIntPtr Minimum,Maximum;
            public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority,Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] struct Io { public ulong Read,Write,Other,ReadBytes,WriteBytes,OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic Limits; public Io IoCounters; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
        [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int info,ref Extended limits,int size);
        [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
        IntPtr handle;
        public ProcessJob(Process process) {
            handle=CreateJobObject(IntPtr.Zero,null);
            var limits=new Extended(); limits.Limits.LimitFlags=0x2000;
            if(handle==IntPtr.Zero || !SetInformationJobObject(handle,9,ref limits,Marshal.SizeOf(limits)) ||
                !AssignProcessToJobObject(handle,process.Handle)) {
                Dispose(); throw new InvalidOperationException("Windows could not manage the local service process.");
            }
        }
        public void Dispose() { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
    }

    internal sealed class MainWindow : Form {
        readonly WebView2 web = new WebView2();
        readonly string app,profile,prefs,demo;
        readonly Label message = new Label();
        string root,origin;
        int port;
        bool allowClosing, checkingClose, switching;
        bool fullscreen, previousTopMost;
        Rectangle previousBounds;
        Padding previousPadding;
        FormWindowState previousWindowState;
        Process service;
        ProcessJob job;

        public MainWindow(string app,string profile,string selectedRoot) {
            this.app=app; this.profile=profile; prefs=Path.Combine(profile,"window.xml");
            if(!File.Exists(Path.Combine(app,"desktop","service.ts"))) throw new FileNotFoundException("Cannot locate the Pivot application at "+app);
            Text="Pivot"; BackColor=Color.FromArgb(21,22,33);
            ClientSize=new Size(1440,868); MinimumSize=new Size(800,520); StartPosition=FormStartPosition.CenterScreen;
            var iconPath=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"pivot.ico");
            if(File.Exists(iconPath)) Icon=new Icon(iconPath);
            var saved=File.Exists(prefs)?XElement.Load(prefs):new XElement("window");
            var projects=Path.Combine(profile,"projects");
            demo=Path.Combine(projects,"pendulum");
            if(!Directory.Exists(demo)) ProvisionDemo(projects);
            root=selectedRoot ?? (string)saved.Element("root");
            if(selectedRoot!=null && !Directory.Exists(selectedRoot)) throw new DirectoryNotFoundException("Workspace does not exist: "+selectedRoot);
            if(String.IsNullOrWhiteSpace(root) || !Directory.Exists(root)) root=projects;
            root=Path.GetFullPath(root);
            Int32.TryParse((string)saved.Element("port"),out port);
            if(port<1024 || port>65535) port=0;
            if((string)saved.Element("maximized")=="true") WindowState=FormWindowState.Maximized;
            Padding=new Padding(3);
            web.Dock=DockStyle.Fill; web.DefaultBackgroundColor=BackColor; Controls.Add(web);
            message.Text="Starting Pivot…"; message.Dock=DockStyle.Fill; message.ForeColor=Color.Gainsboro;
            message.TextAlign=ContentAlignment.MiddleCenter; Controls.Add(message);
            Shown+=async delegate { try {await Initialize();} catch(Exception ex) { Fail(ex); } };
            FormClosing+=OnClosing;
            FormClosed+=delegate { StopService(); web.Dispose(); };
        }
        void ProvisionDemo(string projects) {
            Directory.CreateDirectory(projects);
            string temp=Path.Combine(projects,".new-"+Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temp);
            CopyExample(Path.Combine(app,"examples","pendulum"),temp);
            // Only initialize the application-authored sample. Opening another folder runs no project tasks.
            try {
                Git(temp,"init --template= --quiet -b main");
                Git(temp,"add -- .");
                Git(temp,"-c user.name=\"Pivot contributors\" -c user.email=pivot@localhost commit --quiet -m \"Start pendulum workspace\"");
            } catch(Exception ex) { File.WriteAllText(Path.Combine(profile,"demo-git.txt"),ex.Message); }
            Directory.Move(temp,demo);
        }
        static void CopyExample(string source,string destination) {
            foreach(string entry in Directory.GetFileSystemEntries(source)) {
                var name=Path.GetFileName(entry);
                var attrs=File.GetAttributes(entry);
                if(name==".git" || name=="__pycache__" || (attrs&FileAttributes.ReparsePoint)!=0) continue;
                string outPath=Path.Combine(destination,name);
                if((attrs&FileAttributes.Directory)!=0) {
                    Directory.CreateDirectory(outPath);CopyExample(entry,outPath);
                } else File.Copy(entry,outPath);
            }
        }
        static void Git(string workingDirectory,string arguments) {
            var exe=(Environment.GetEnvironmentVariable("PATH")??"").Split(';')
                .Select(p=>p.Trim('"')).Where(p=>Path.IsPathRooted(p)).Select(p=>Path.Combine(p,"git.exe")).FirstOrDefault(File.Exists);
            if(exe==null) throw new FileNotFoundException("Git for Windows is missing. The copied project is available without Git.");
            var info=new ProcessStartInfo(exe,"-c core.hooksPath=NUL -c commit.gpgSign=false "+arguments) {
                WorkingDirectory=workingDirectory,UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true,RedirectStandardOutput=true
            };
            info.EnvironmentVariables["GIT_CONFIG_NOSYSTEM"]="1";info.EnvironmentVariables["GIT_CONFIG_GLOBAL"]="NUL";
            using(var git=Process.Start(info)) {
                git.BeginOutputReadLine();git.BeginErrorReadLine();
                if(!git.WaitForExit(10000)) {git.Kill();throw new TimeoutException("Git timed out preparing the example.");}
                if(git.ExitCode!=0) throw new InvalidOperationException("Git could not initialize the example.");
            }
        }
        void Save() {
            var doc=new XElement("window",new XElement("root",root),new XElement("port",port),
                new XElement("maximized",(fullscreen?previousWindowState:WindowState)==FormWindowState.Maximized?"true":"false"));
            string tmp=prefs+".tmp"; doc.Save(tmp);
            if(File.Exists(prefs)) File.Replace(tmp,prefs,null); else File.Move(tmp,prefs);
        }
        async Task Initialize() {
            var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(profile,"WebView2"));
            await web.EnsureCoreWebView2Async(env);
            var core=web.CoreWebView2;
            core.Settings.AreBrowserAcceleratorKeysEnabled=false;
            core.Settings.AreDefaultContextMenusEnabled=false;
            core.Settings.AreHostObjectsAllowed=false;
            core.Settings.IsStatusBarEnabled=false;
            core.Settings.IsZoomControlEnabled=false;
            core.WebMessageReceived+=OnMessage;
            core.ContainsFullScreenElementChanged+=(sender,e)=>SetFullscreen(core.ContainsFullScreenElement);
            core.NavigationStarting+=(sender,e)=>{
                Uri target;
                e.Cancel=!Uri.TryCreate(e.Uri,UriKind.Absolute,out target) || target.GetLeftPart(UriPartial.Authority)!=origin;
            };
            core.NewWindowRequested+=(sender,e)=>{
                e.Handled=true;
                Uri target;
                if(e.IsUserInitiated && Uri.TryCreate(e.Uri,UriKind.Absolute,out target) && target.Scheme=="https")
                    Process.Start(new ProcessStartInfo(target.AbsoluteUri){UseShellExecute=true});
            };
            core.NavigationCompleted+=(sender,e)=>{
                if(e.IsSuccess) { message.Visible=false; web.Focus(); }
                else if(!switching) Fail(new InvalidOperationException("The local workbench could not load: "+e.WebErrorStatus));
            };
            await StartService();
        }
        void SetFullscreen(bool enabled) {
            if(fullscreen==enabled) return;
            if(enabled) {
                var display=Screen.FromControl(this);
                previousWindowState=WindowState;
                previousBounds=WindowState==FormWindowState.Normal?Bounds:RestoreBounds;
                previousPadding=Padding;
                previousTopMost=TopMost;
                fullscreen=true;
                WindowState=FormWindowState.Normal;
                Padding=Padding.Empty;
                Bounds=display.Bounds;
                TopMost=true;
            } else {
                fullscreen=false;
                TopMost=previousTopMost;
                Padding=previousPadding;
                Bounds=previousBounds;
                WindowState=previousWindowState;
            }
        }
        static string Quote(string value) {
            // Windows argv escaping, including a folder path ending in a backslash.
            var outp=new StringBuilder("\""); int slashes=0;
            foreach(char c in value) {
                if(c=='\\') {slashes++;continue;}
                if(c=='"') outp.Append('\\',slashes*2+1); else outp.Append('\\',slashes);
                slashes=0;outp.Append(c);
            }
            return outp.Append('\\',slashes*2).Append('"').ToString();
        }
        async Task StartService() {
            var exe=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"node.exe");
            if(!File.Exists(exe)) exe="node.exe";
            var ready=new TaskCompletionSource<int>();
            var errors=new StringBuilder();
            var process=new Process();
            process.StartInfo=new ProcessStartInfo(exe,"desktop/service.ts "+Quote(root)+" "+port) {
                WorkingDirectory=app,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,
                RedirectStandardError=true,RedirectStandardInput=true
            };
            process.StartInfo.EnvironmentVariables["PIVOT_DEMO_DIR"]=demo;
            process.OutputDataReceived+=(s,e)=>{
                int assigned;
                if(e.Data!=null && e.Data.StartsWith("PIVOT_READY ") && Int32.TryParse(e.Data.Substring(12),out assigned))
                    ready.TrySetResult(assigned);
            };
            process.ErrorDataReceived+=(s,e)=>{ if(e.Data!=null) lock(errors) { if(errors.Length<4000) errors.AppendLine(e.Data); } };
            process.EnableRaisingEvents=true;
            process.Exited+=(s,e)=>{
                string detail;lock(errors) detail=errors.ToString();
                ready.TrySetException(new InvalidOperationException("Local service stopped. "+detail));
                if(ready.Task.Status==TaskStatus.RanToCompletion && process==service && IsHandleCreated && !IsDisposed)
                    BeginInvoke((Action)delegate { if(process==service && !allowClosing) Fail(new InvalidOperationException("The local service stopped. "+detail)); });
            };
            process.Start();service=process;
            try { job=new ProcessJob(process); }
            catch { process.Kill(); throw; }
            process.BeginOutputReadLine();process.BeginErrorReadLine();process.StandardInput.WriteLine("start");
            if(await Task.WhenAny(ready.Task,Task.Delay(20000))!=ready.Task) throw new TimeoutException("Timed out waiting for the local service.");
            port=await ready.Task;
            origin="http://127.0.0.1:"+port;
            Save();web.CoreWebView2.Navigate(origin+"/");
        }
        void StopService() {
            var old=service;service=null;
            if(old!=null) {
                try { if(!old.HasExited) { old.StandardInput.WriteLine("stop"); old.WaitForExit(1800); } } catch(InvalidOperationException) {} catch(IOException) {}
            }
            if(job!=null) {job.Dispose();job=null;}
            if(old!=null) old.Dispose();
        }
        void Fail(Exception ex) {
            message.Text="Pivot could not start.\n\n"+ex.GetBaseException().Message+"\n\nCheck the desktop setup instructions.";message.Visible=true;
            message.BringToFront();
            File.WriteAllText(Path.Combine(profile,"startup-error.txt"),ex.ToString());
        }
        async Task<bool> ConfirmLeaving() {
            if(web.CoreWebView2==null || String.IsNullOrEmpty(origin)) return true;
            string ok=await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('beforeunload', {cancelable:true}))");
            return ok!="false" || MessageBox.Show("Closing this workspace ends its terminal and editor sessions. Continue?",
                "Pivot",MessageBoxButtons.YesNo,MessageBoxIcon.Question,MessageBoxDefaultButton.Button2)==DialogResult.Yes;
        }
        async void OnClosing(object sender,FormClosingEventArgs e) {
            if(allowClosing) return;
            e.Cancel=true;
            if(checkingClose) return;
            checkingClose=true;
            bool leave=false;
            try {leave=await ConfirmLeaving();} catch {leave=true;}
            checkingClose=false;
            if(leave) {allowClosing=true;Save();BeginInvoke((Action)Close);}
        }
        async void OnMessage(object sender,CoreWebView2WebMessageReceivedEventArgs e) {
            Uri source;
            if(!Uri.TryCreate(e.Source,UriKind.Absolute,out source) || source.GetLeftPart(UriPartial.Authority)!=origin) return;
            string action; try {action=e.TryGetWebMessageAsString();} catch {return;}
            switch(action) {
                case "minimize": WindowState=FormWindowState.Minimized; break;
                case "maximize": WindowState=WindowState==FormWindowState.Maximized?FormWindowState.Normal:FormWindowState.Maximized;break;
                case "close": Close();break;
                case "drag": ReleaseCapture();SendMessage(Handle,0xA1,(IntPtr)2,IntPtr.Zero);break;
                case "open-folder":
                    if(switching) return;
                    using(var dialog=new FolderBrowserDialog()) {
                        dialog.Description="Choose your trusted Pivot workspace folder.";dialog.SelectedPath=root;
                        if(dialog.ShowDialog(this)!=DialogResult.OK || String.Equals(dialog.SelectedPath,root,StringComparison.OrdinalIgnoreCase)) return;
                        if(!await ConfirmLeaving()) return;
                        switching=true;
                        try { StopService();root=dialog.SelectedPath;await StartService(); } catch(Exception ex) { Fail(ex); }
                        finally { switching=false; }
                    }
                    break;
            }
        }
        [DllImport("user32.dll")] static extern bool ReleaseCapture();
        [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr hWnd,int msg,IntPtr wParam,IntPtr lParam);
        protected override void WndProc(ref Message m) {
            // Keep the native sizing border while letting Pivot draw its title bar.
            if(m.Msg==0x83 && m.WParam!=IntPtr.Zero) {m.Result=IntPtr.Zero;return;}
            base.WndProc(ref m);
            if(m.Msg==0x84 && m.Result==(IntPtr)1 && WindowState==FormWindowState.Normal && !fullscreen) {
                var p=PointToClient(Cursor.Position); bool l=p.X<4,r=p.X>=ClientSize.Width-4,t=p.Y<4,b=p.Y>=ClientSize.Height-4;
                int hit=t?(l?13:r?14:12):b?(l?16:r?17:15):l?10:r?11:1;m.Result=(IntPtr)hit;
            }
        }
    }
}
