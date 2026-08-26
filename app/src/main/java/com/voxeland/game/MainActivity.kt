package com.voxeland.game

import android.annotation.SuppressLint
import android.app.Activity
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.opengl.GLSurfaceView
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import com.voxeland.game.audio.SoundManager
import com.voxeland.game.core.Environment
import com.voxeland.game.core.LightSpec
import com.voxeland.game.entity.Player
import com.voxeland.game.core.World
import com.voxeland.game.gl.GameRenderer
import com.voxeland.game.items.Stack
import com.voxeland.game.progression.Character
import com.voxeland.game.save.SaveManager
import com.voxeland.game.ui.GameHud
import com.voxeland.game.ui.MenuViews
import com.voxeland.game.ui.Panels
import com.voxeland.game.ui.UiKit

class MainActivity : Activity(), GameEngine.Listener, GameHud.Callbacks {

    private lateinit var root: FrameLayout
    private var sound: SoundManager? = null
    private var engine: GameEngine? = null
    private var glView: GLSurfaceView? = null
    private var renderer: GameRenderer? = null
    private var overlay: View? = null
    @Volatile private var toastMsg: String? = null
    private var toastUntil = 0L

    // shaking the handset winds the dynamo torch — the reason it is called one
    private var sensors: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var lastShakeNs = 0L
    private val shakeListener = object : SensorEventListener {
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
        override fun onSensorChanged(e: SensorEvent) {
            val eng = engine ?: return
            if (eng.paused || eng.dead) return
            val now = System.nanoTime()
            val dt = if (lastShakeNs == 0L) 0f else ((now - lastShakeNs) / 1e9f).coerceAtMost(0.1f)
            lastShakeNs = now
            if (dt <= 0f) return
            val mag = kotlin.math.sqrt(
                e.values[0] * e.values[0] + e.values[1] * e.values[1] + e.values[2] * e.values[2])
            // gravity is always present, so only motion beyond it counts
            val jolt = kotlin.math.abs(mag - SensorManager.GRAVITY_EARTH)
            if (jolt > LightSpec.SHAKE_THRESHOLD)
                eng.windUp((jolt - LightSpec.SHAKE_THRESHOLD) * LightSpec.SHAKE_GAIN * dt)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this)
        setContentView(root)
        sound = SoundManager(this)
        sensors = getSystemService(SENSOR_SERVICE) as? SensorManager
        accelerometer = sensors?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        showMenu()
    }

    private fun showMenu() {
        stopGame()
        root.removeAllViews()
        root.addView(MenuViews.mainMenu(this, SaveManager.exists(this),
            onContinue = {
                sound?.play("ui_click")
                val loaded = SaveManager.load(this)
                if (loaded != null) startGame(loaded.world, loaded.player, loaded.env)
                else { SaveManager.delete(this); showCharacterCreation() }
            },
            onNewGame = {
                sound?.play("ui_click")
                showCharacterCreation()
            }))
    }

    private fun showCharacterCreation() {
        root.removeAllViews()
        root.addView(MenuViews.characterCreation(this) { character: Character ->
            SaveManager.delete(this)
            val seed = System.currentTimeMillis()
            val (world, player) = GameEngine.newGame(seed, character)
            startGame(world, player, Environment())
        })
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun startGame(world: World, player: Player, env: Environment) {
        root.removeAllViews()
        val snd = sound ?: SoundManager(this).also { sound = it }
        val eng = GameEngine(world, player, env, snd)
        eng.listener = this
        engine = eng

        val gv = GLSurfaceView(this)
        gv.setEGLContextClientVersion(3)
        gv.preserveEGLContextOnPause = true
        val rnd = GameRenderer(eng)
        gv.setRenderer(rnd)
        gv.renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
        renderer = rnd
        glView = gv
        root.addView(gv)

        val hud = GameHud(this, eng, this)
        root.addView(hud)
        snd.startAmbient()
    }

    private fun stopGame() {
        renderer?.shutdown()
        renderer = null
        glView = null
        engine = null
        overlay = null
        sound?.pauseAmbient()
    }

    // ------------------------------------------------------------ overlays

    private fun openOverlay(v: View) {
        closeOverlay()
        engine?.paused = true
        overlay = v
        root.addView(v)
    }

    private fun closeOverlay() {
        overlay?.let { root.removeView(it) }
        overlay = null
        engine?.paused = false
    }

    override fun onPause() {
        super.onPause()
        engine?.paused = true
        glView?.onPause()
        saveNow()
        sound?.pauseAmbient()
        sensors?.unregisterListener(shakeListener)
        lastShakeNs = 0L
    }

    override fun onResume() {
        super.onResume()
        glView?.onResume()
        accelerometer?.let {
            sensors?.registerListener(shakeListener, it, SensorManager.SENSOR_DELAY_GAME)
        }
        if (engine != null && overlay == null) {
            engine?.paused = false
            sound?.startAmbient()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        stopGame()
        sound?.release()
        sound = null
    }

    private fun saveNow() {
        val e = engine ?: return
        if (!e.dead) SaveManager.save(this, e.world, e.player, e.env)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (overlay != null) { closeOverlay(); return }
        if (engine != null) { onPauseMenu(); return }
        super.onBackPressed()
    }

    // ------------------------------------------------------------ GameHud.Callbacks

    override fun onPauseMenu() {
        val e = engine ?: return
        openOverlay(Panels.pause(this, e,
            onResume = { sound?.play("ui_click"); closeOverlay() },
            onSaveQuit = {
                sound?.play("ui_click")
                saveNow()
                showMenu()
            }))
    }

    override fun onOpenInventory() {
        val e = engine ?: return
        openOverlay(Panels.inventory(this, e) { closeOverlay() })
    }

    override fun onOpenSkills() {
        val e = engine ?: return
        openOverlay(Panels.skills(this, e) { closeOverlay() })
    }

    override fun onAutosave() { saveNow() }

    override fun toastText(): String? {
        if (System.currentTimeMillis() > toastUntil) return null
        return toastMsg
    }

    // ------------------------------------------------------------ GameEngine.Listener (GL thread!)

    override fun onDeath(cause: String) {
        val e = engine ?: return
        runOnUiThread {
            SaveManager.delete(this)      // permadeath — realism has stakes
            val stats = "Survived ${(e.player.timeSurvived / 60).toInt()} minutes over ${e.env.dayCount + 1} day(s)\n" +
                    "${e.player.kills} zombies put down · level ${e.player.level}"
            openOverlay(Panels.death(this, cause, stats) { showMenu() })
        }
    }

    override fun onLevelUp(level: Int) {
        sound?.play("level_up")
        toast("Level $level — training point earned.")
    }

    override fun onLootFound(items: List<Stack>, overflow: Boolean) {
        runOnUiThread {
            val v = Panels.lootToast(this, items, overflow)
            val lp = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER_HORIZONTAL or Gravity.TOP)
            lp.topMargin = (120 * resources.displayMetrics.density).toInt()
            root.addView(v, lp)
            v.postDelayed({ root.removeView(v) }, 2600)
        }
    }

    override fun onToast(msg: String) = toast(msg)

    private fun toast(msg: String) {
        toastMsg = msg
        toastUntil = System.currentTimeMillis() + 3000
    }
}
