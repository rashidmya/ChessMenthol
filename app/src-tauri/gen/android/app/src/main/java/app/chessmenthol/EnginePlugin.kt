package app.chessmenthol

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.BufferedReader
import java.io.InputStreamReader
import java.util.Collections

@InvokeArg
class SendArgs {
    var line: String = ""
}

// Native UCI engine bridge for Android. Spawns the bundled libstockfish.so from the
// app's nativeLibraryDir (the one place Android lets us exec a packaged binary). Stdout
// lines are buffered and drained by JS via the `poll` command (a polling app-command
// path is used instead of push events because plugin events are ACL-gated and this
// inline plugin has no permission manifest). Driven from Rust (mobile_engine.rs).
@TauriPlugin
class EnginePlugin(private val activity: Activity) : Plugin(activity) {
    private var proc: Process? = null
    private val lines = Collections.synchronizedList(ArrayList<String>())

    @Command
    fun start(invoke: Invoke) {
        stopProcess()
        lines.clear()
        try {
            val dir = activity.applicationInfo.nativeLibraryDir
            val p = ProcessBuilder("$dir/libstockfish.so").redirectErrorStream(true).start()
            proc = p
            Thread {
                try {
                    val br = BufferedReader(InputStreamReader(p.inputStream))
                    while (true) {
                        val line = br.readLine() ?: break
                        lines.add(line)
                    }
                } catch (_: Exception) {
                    // process ended / stream closed
                }
            }.apply { isDaemon = true }.start()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("engine start failed: ${e.message}")
        }
    }

    @Command
    fun send(invoke: Invoke) {
        val line = invoke.parseArgs(SendArgs::class.java).line
        val p = proc
        if (p == null) {
            invoke.reject("no engine running")
            return
        }
        try {
            p.outputStream.write((line + "\n").toByteArray())
            p.outputStream.flush()
            invoke.resolve(JSObject())
        } catch (e: Exception) {
            invoke.reject("engine send failed: ${e.message}")
        }
    }

    @Command
    fun poll(invoke: Invoke) {
        val arr = JSArray()
        synchronized(lines) {
            for (l in lines) arr.put(l)
            lines.clear()
        }
        val ret = JSObject()
        ret.put("lines", arr)
        invoke.resolve(ret)
    }

    @Command
    fun stop(invoke: Invoke) {
        stopProcess()
        invoke.resolve(JSObject())
    }

    override fun onPause() {
        // Don't leave an orphaned engine process when the app is backgrounded.
        stopProcess()
    }

    private fun stopProcess() {
        try { proc?.destroy() } catch (_: Exception) {}
        proc = null
    }
}
