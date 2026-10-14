using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32.SafeHandles;

[assembly: System.Reflection.AssemblyTitle("Forma Windows Launcher")]
[assembly: System.Reflection.AssemblyDescription("Local launcher for an existing Forma installation")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("1.0.0.0")]

namespace FormaDesktop
{
    // The job owns only this launcher's processes. It never stops another Forma
    // instance, and Windows cleans up its children even if the launcher crashes.
    internal sealed class OwnedJob : SafeHandleZeroOrMinusOneIsInvalid
    {
        [StructLayout(LayoutKind.Sequential)] struct BasicLimits
        {
            public long ProcessTime, JobTime;
            public uint Flags;
            public UIntPtr MinWorkingSet, MaxWorkingSet;
            public uint ActiveProcesses;
            public UIntPtr Affinity;
            public uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters
        { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits
        {
            public BasicLimits Basic;
            public IoCounters Io;
            public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern IntPtr CreateJobObject(IntPtr attributes, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetInformationJobObject(OwnedJob job, int type, ref ExtendedLimits info, uint size);
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool AssignProcessToJobObject(OwnedJob job, IntPtr process);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

        public OwnedJob() : base(true)
        {
            SetHandle(CreateJobObject(IntPtr.Zero, null));
            if (IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var info = new ExtendedLimits();
            info.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(this, 9, ref info, (uint)Marshal.SizeOf(info)))
            {
                int error = Marshal.GetLastWin32Error();
                Dispose();
                throw new Win32Exception(error);
            }
        }
        public void Assign(Process process)
        {
            if (!AssignProcessToJobObject(this, process.Handle))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Windows could not safely manage Forma's processes.");
        }
        protected override bool ReleaseHandle() { return CloseHandle(handle); }
    }

    public sealed class Runner : IDisposable
    {
        Process child;
        OwnedJob job;
        public string Url { get; private set; }
        public Action<string> Log;
        public bool IsRunning { get { return child != null && !child.HasExited; } }
        public int ExitCode { get { return child == null ? -1 : child.ExitCode; } }

        public static bool IsFormaFolder(string root)
        {
            return File.Exists(Path.Combine(root, "scripts", "windows.cjs")) &&
                File.Exists(Path.Combine(root, "server.cjs")) && File.Exists(Path.Combine(root, "package.json"));
        }
        static string NodePath(string root)
        {
            string portable = Path.Combine(root, "runtime", "node.exe");
            if (File.Exists(portable)) return portable;
            string installed = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe");
            if (File.Exists(installed)) return installed;
            foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try
                {
                    string candidate = Path.Combine(folder.Trim().Trim('"'), "node.exe");
                    if (Path.IsPathRooted(candidate) && File.Exists(candidate)) return candidate;
                }
                catch (ArgumentException) { }
            }
            throw new FileNotFoundException("Node.js was not found. Keep runtime\\node.exe from your existing Forma package, or use an approved Node.js 24 installation.");
        }
        void Output(string line)
        {
            if (line == null) return;
            Match match = Regex.Match(line.Trim(), @"^Open (http://127\.0\.0\.1:([0-9]{4,5})/) in your browser\.$");
            int port;
            if (match.Success && Int32.TryParse(match.Groups[2].Value, out port) && port >= 1024 && port <= 65535)
                Url = match.Groups[1].Value;
            if (Log != null) Log(line);
        }
        public void Start(string root, string mode)
        {
            if (child != null) throw new InvalidOperationException("This runner has already been used.");
            if (!IsFormaFolder(root)) throw new DirectoryNotFoundException("Select the extracted glm-design-pilot folder containing server.cjs and scripts\\windows.cjs.");
            if (mode != "" && mode != "--setup" && mode != "--check") throw new ArgumentException("Unsupported startup action.");
            // Wait for the parent to assign the Windows job BEFORE loading Forma.
            // Paths are passed through WorkingDirectory, never shell interpolation.
            const string bootstrap = "process.stdin.once('data',()=>{process.stdin.pause();if(process.argv.includes('--setup')||process.argv.includes('--check'))process.stdin.destroy();require('./scripts/windows.cjs');});";
            var info = new ProcessStartInfo(NodePath(root), "-e \"" + bootstrap + "\" -- " + mode);
            info.WorkingDirectory = Path.GetFullPath(root);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardInput = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            info.StandardOutputEncoding = Encoding.UTF8;
            info.StandardErrorEncoding = Encoding.UTF8;
            child = new Process();
            child.StartInfo = info;
            child.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { Output(e.Data); };
            child.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { Output(e.Data); };
            try
            {
                job = new OwnedJob();
                child.Start();
                job.Assign(child);
                child.BeginOutputReadLine();
                child.BeginErrorReadLine();
                child.StandardInput.WriteLine("start");
                child.StandardInput.Flush();
            }
            catch
            {
                // Before assignment the Node bootstrap cannot create descendants.
                try { if (!child.HasExited) child.Kill(); } catch (InvalidOperationException) { }
                Dispose();
                throw;
            }
        }
        public async Task StopAsync()
        {
            if (child == null) return;
            try
            {
                if (!child.HasExited)
                {
                    try { child.StandardInput.WriteLine(); child.StandardInput.Flush(); }
                    catch (IOException) { }
                    if (!await Task.Run(() => child.WaitForExit(5000)))
                    {
                        if (job != null) job.Dispose();
                        await Task.Run(() => child.WaitForExit(3000));
                    }
                }
                if (child.HasExited) child.WaitForExit(); // Drain asynchronous output.
            }
            finally { if (job != null) job.Dispose(); }
        }
        public void Dispose()
        {
            if (job != null) { job.Dispose(); job = null; }
            if (child != null) { child.Dispose(); child = null; }
        }
    }

    public sealed class LauncherWindow : Form
    {
        readonly Label state = new Label(), folderLabel = new Label();
        readonly TextBox output = new TextBox();
        readonly Button start = new Button(), stop = new Button(), open = new Button(), settings = new Button(), choose = new Button();
        readonly Timer monitor = new Timer();
        Runner runner;
        string root, url;
        bool busy, closing, closeReady;
        DateTime started;

        public LauncherWindow()
        {
            Text = "Forma";
            Font = new Font("Segoe UI", 10);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(700, 460);
            MinimumSize = new Size(650, 450);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 249, 251);
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 6 };
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 44));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 52));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            layout.Controls.Add(new Label { Text = "Forma", Font = new Font("Segoe UI", 24, FontStyle.Bold), AutoSize = true }, 0, 0);
            state.Text = "Select your Forma folder to begin.";
            state.Dock = DockStyle.Fill;
            state.ForeColor = Color.FromArgb(39, 93, 173);
            layout.Controls.Add(state, 0, 1);
            folderLabel.Dock = DockStyle.Fill;
            folderLabel.AutoEllipsis = true;
            folderLabel.ForeColor = Color.DimGray;
            layout.Controls.Add(folderLabel, 0, 2);
            var buttons = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
            foreach (Button b in new[] { start, stop, open, settings, choose })
            {
                b.AutoSize = true; b.Height = 34; b.Padding = new Padding(8, 2, 8, 2);
                buttons.Controls.Add(b);
            }
            start.Text = "Start"; stop.Text = "Stop"; open.Text = "Open Forma"; settings.Text = "Settings"; choose.Text = "Choose folder";
            layout.Controls.Add(buttons, 0, 3);
            output.Multiline = true; output.ReadOnly = true; output.ScrollBars = ScrollBars.Vertical;
            output.Dock = DockStyle.Fill; output.BackColor = Color.White;
            output.Font = new Font("Consolas", 9);
            layout.Controls.Add(output, 0, 4);
            layout.Controls.Add(new Label { Text = "Keep this window open while using Forma. Closing it stops the local app.\nThe GLM model is supplied by the endpoint configured in Settings.", Dock = DockStyle.Fill, Font = new Font("Segoe UI", 9) }, 0, 5);
            Controls.Add(layout);
            start.Click += async delegate { await StartForma(); };
            stop.Click += async delegate { await StopForma(); };
            open.Click += delegate { OpenBrowser(); };
            settings.Click += async delegate { await EditSettings(); };
            choose.Click += delegate { SelectFolder(); };
            monitor.Interval = 250;
            monitor.Tick += async delegate
            {
                if (runner == null || busy) return;
                if (!runner.IsRunning)
                {
                    bool failed = runner.ExitCode != 0;
                    runner.Dispose(); runner = null; url = null;
                    state.Text = failed ? "Could not start or keep Forma running. See details below." : "Forma is stopped.";
                    UpdateButtons();
                }
                else if (url == null && runner.Url != null)
                {
                    url = runner.Url;
                    state.Text = "Forma is running at " + url;
                    UpdateButtons();
                    OpenBrowser();
                }
                else if (url == null && (DateTime.UtcNow - started).TotalSeconds > 150)
                {
                    await StopForma();
                    state.Text = "Startup timed out. Review the details and Settings.";
                }
            };
            FormClosing += async delegate(object sender, FormClosingEventArgs e)
            {
                if (closeReady) return;
                e.Cancel = true;
                if (closing) return;
                closing = true;
                while (busy) await Task.Delay(100);
                await StopForma();
                closeReady = true;
                Close();
            };
            Shown += async delegate
            {
                string adjacent = AppDomain.CurrentDomain.BaseDirectory;
                if (Runner.IsFormaFolder(adjacent)) root = adjacent;
                else if (Runner.IsFormaFolder(Path.Combine(adjacent, "glm-design-pilot"))) root = Path.Combine(adjacent, "glm-design-pilot");
                else SelectFolder();
                folderLabel.Text = root ?? "No Forma folder selected.";
                monitor.Start();
                UpdateButtons();
                if (root != null) await StartForma();
            };
            UpdateButtons();
        }
        void UpdateButtons()
        {
            bool active = runner != null;
            start.Enabled = !closing && !busy && !active && root != null;
            stop.Enabled = !closing && !busy && active;
            open.Enabled = !closing && !busy && url != null;
            settings.Enabled = !closing && !busy && !active && root != null;
            choose.Enabled = !closing && !busy && !active;
        }
        void Append(string line)
        {
            if (IsDisposed || !IsHandleCreated) return;
            try { BeginInvoke((Action)delegate
            {
                if (output.TextLength > 40000) output.Clear();
                output.AppendText(line + Environment.NewLine);
            }); }
            catch (InvalidOperationException) { }
        }
        void SelectFolder()
        {
            using (var dialog = new FolderBrowserDialog { Description = "Choose your extracted glm-design-pilot folder. Runtime and dependencies must already be installed.", ShowNewFolderButton = false })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                if (!Runner.IsFormaFolder(dialog.SelectedPath))
                {
                    MessageBox.Show(this, "This folder does not contain Forma. Select the glm-design-pilot folder containing server.cjs.", "Forma");
                    return;
                }
                root = dialog.SelectedPath;
                folderLabel.Text = root;
                state.Text = "Ready. Click Start to open Forma.";
                UpdateButtons();
            }
        }
        async Task<bool> EnsureSettings()
        {
            bool existed = File.Exists(Path.Combine(root, ".env"));
            if (existed) return true;
            using (var setup = new Runner { Log = Append })
            {
                setup.Start(root, "--setup");
                DateTime limit = DateTime.UtcNow.AddSeconds(15);
                while (setup.IsRunning && DateTime.UtcNow < limit) await Task.Delay(100);
                if (setup.IsRunning) { await setup.StopAsync(); throw new Exception("Configuration timed out."); }
                if (setup.ExitCode != 0) throw new Exception("Could not create settings. See details below.");
            }
            return false;
        }
        void ShowSettings()
        {
            var info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "notepad.exe"));
            info.Arguments = "\"" + Path.Combine(root, ".env") + "\"";
            info.UseShellExecute = false;
            Process.Start(info); // Intentional editor window for user configuration.
            state.Text = "Save your Settings, then click Start. APP_PASSWORD is your login password.";
        }
        async Task EditSettings()
        {
            busy = true; UpdateButtons();
            try { await EnsureSettings(); ShowSettings(); }
            catch (Exception e) { state.Text = "Settings could not be opened."; Append(e.Message); }
            finally { busy = false; UpdateButtons(); }
        }
        async Task StartForma()
        {
            if (root == null || runner != null || busy || closing) return;
            busy = true; output.Clear(); UpdateButtons();
            try
            {
                if (!await EnsureSettings()) { ShowSettings(); return; }
                runner = new Runner { Log = Append };
                runner.Start(root, "");
                started = DateTime.UtcNow;
                state.Text = "Starting Forma...";
            }
            catch (Exception e)
            {
                if (runner != null) { runner.Dispose(); runner = null; }
                state.Text = "Forma could not start. See details below."; Append(e.Message);
            }
            finally { busy = false; UpdateButtons(); }
        }
        async Task StopForma()
        {
            if (runner == null) return;
            busy = true; state.Text = "Stopping Forma..."; UpdateButtons();
            try { await runner.StopAsync(); }
            catch (Exception e) { Append(e.Message); }
            finally { runner.Dispose(); runner = null; url = null; busy = false; state.Text = "Forma is stopped."; UpdateButtons(); }
        }
        void OpenBrowser()
        {
            if (url == null) return;
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception e) { Append("Could not open your browser. Open " + url + " manually. " + e.Message); }
        }
    }
    internal static class Program
    {
        [STAThread] static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new LauncherWindow());
        }
    }
}
