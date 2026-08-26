package com.voxeland.game.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import com.voxeland.game.GameEngine
import com.voxeland.game.items.Items
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.min
import kotlin.math.sqrt

/**
 * The whole in-game HUD and touch surface in one intuitive pass:
 *  - left thumb: virtual joystick (drag up past the rim to sprint)
 *  - right thumb: look; the dedicated ATTACK/USE/JUMP cluster sits above it
 *  - bottom: 5-slot hotbar, tap to select
 *  - top-left vitals, top-center compass (once earned), top-right clock
 * Everything is drawn from code — no layout XML, no bitmaps.
 */
@SuppressLint("ViewConstructor")
class GameHud(
    ctx: Context,
    private val engine: GameEngine,
    private val callbacks: Callbacks,
) : View(ctx) {

    interface Callbacks {
        fun onPauseMenu()
        fun onOpenInventory()
        fun onOpenSkills()
        fun onAutosave()
        fun toastText(): String?
    }

    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.MONOSPACE
        textAlign = Paint.Align.CENTER
    }

    // touch state
    private var joyPointer = -1
    private var joyBaseX = 0f; private var joyBaseY = 0f
    private var joyX = 0f; private var joyY = 0f
    private var lookPointer = -1
    private var lastLookX = 0f; private var lastLookY = 0f
    var lookSensitivity = 0.0042f

    // buttons
    private class Btn(val id: String, val label: String) {
        val rect = RectF(); var pressed = false
    }
    private val btnAttack = Btn("attack", "ATK")
    private val btnUse = Btn("use", "USE")
    private val btnJump = Btn("jump", "JMP")
    private val btnCrouch = Btn("crouch", "CRC")
    private val btnLight = Btn("light", "LMP")
    private val btnPause = Btn("pause", "II")
    private val btnInv = Btn("inv", "BAG")
    private val btnSkill = Btn("skill", "SKL")
    private val buttons = listOf(btnAttack, btnUse, btnJump, btnCrouch, btnLight, btnPause, btnInv, btnSkill)
    private val hotbarRects = Array(5) { RectF() }

    private var w = 0f; private var h = 0f; private var den = 1f

    init {
        den = resources.displayMetrics.density
        // ~30 fps HUD refresh
        val ticker = object : Runnable {
            override fun run() {
                if (parent == null && !isAttachedToWindow) return   // torn down
                if (engine.saveRequested) { engine.saveRequested = false; callbacks.onAutosave() }
                invalidate()
                postDelayed(this, 33)
            }
        }
        post(ticker)
    }

    private fun dp(v: Float) = v * den

    override fun onSizeChanged(nw: Int, nh: Int, ow: Int, oh: Int) {
        w = nw.toFloat(); h = nh.toFloat()
        val bs = dp(34f)   // button radius
        // right-hand cluster
        btnAttack.rect.set(w - dp(120f) - bs, h - dp(120f) - bs, w - dp(120f) + bs, h - dp(120f) + bs)
        btnJump.rect.set(w - dp(52f) - bs, h - dp(170f) - bs, w - dp(52f) + bs, h - dp(170f) + bs)
        btnUse.rect.set(w - dp(52f) - bs, h - dp(70f) - bs, w - dp(52f) + bs, h - dp(70f) + bs)
        btnCrouch.rect.set(dp(30f), h - dp(190f) - dp(26f), dp(30f) + dp(76f), h - dp(190f) + dp(26f))
        btnLight.rect.set(dp(114f), h - dp(190f) - dp(26f), dp(114f) + dp(76f), h - dp(190f) + dp(26f))
        // top-right utility row
        val tr = dp(24f)
        btnPause.rect.set(w - dp(56f), dp(12f), w - dp(12f), dp(12f) + tr * 2)
        btnInv.rect.set(w - dp(116f), dp(12f), w - dp(64f), dp(12f) + tr * 2)
        btnSkill.rect.set(w - dp(176f), dp(12f), w - dp(124f), dp(12f) + tr * 2)
        // hotbar
        val slot = dp(52f)
        val total = slot * 5 + dp(8f) * 4
        val x0 = (w - total) / 2
        for (i in 0 until 5)
            hotbarRects[i].set(x0 + i * (slot + dp(8f)), h - slot - dp(10f), x0 + i * (slot + dp(8f)) + slot, h - dp(10f))
    }

    // ------------------------------------------------------------ touch

    override fun onTouchEvent(ev: MotionEvent): Boolean {
        val action = ev.actionMasked
        val idx = ev.actionIndex
        val pid = ev.getPointerId(idx)
        val x = ev.getX(idx); val y = ev.getY(idx)

        when (action) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                // buttons first
                for (b in buttons) if (b.rect.contains(x, y)) { press(b, pid); return true }
                for (i in 0 until 5) if (hotbarRects[i].contains(x, y)) {
                    engine.post { engine.player.inventory.selected = i }
                    engine.sound.play("ui_click", 0.5f)
                    return true
                }
                if (x < w * 0.42f && joyPointer == -1) {
                    joyPointer = pid; joyBaseX = x; joyBaseY = y; joyX = x; joyY = y
                } else if (lookPointer == -1) {
                    lookPointer = pid; lastLookX = x; lastLookY = y
                }
            }
            MotionEvent.ACTION_MOVE -> {
                for (i in 0 until ev.pointerCount) {
                    val id = ev.getPointerId(i)
                    val mx = ev.getX(i); val my = ev.getY(i)
                    if (id == joyPointer) {
                        joyX = mx; joyY = my
                        updateJoystick()
                    } else if (id == lookPointer) {
                        val dx = mx - lastLookX; val dy = my - lastLookY
                        lastLookX = mx; lastLookY = my
                        engine.player.yaw += dx * lookSensitivity
                        engine.player.pitch = (engine.player.pitch + dy * lookSensitivity)
                            .coerceIn(-1.45f, 1.45f)
                    }
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_CANCEL -> {
                if (pid == joyPointer) {
                    joyPointer = -1; engine.moveX = 0f; engine.moveZ = 0f
                    engine.player.sprinting = false
                }
                if (pid == lookPointer) lookPointer = -1
                for (b in buttons) if (b.pressed && pressedBy[b.id] == pid) release(b)
                if (action == MotionEvent.ACTION_CANCEL) {
                    joyPointer = -1; lookPointer = -1
                    engine.moveX = 0f; engine.moveZ = 0f
                    buttons.forEach { release(it) }
                }
            }
        }
        return true
    }

    private val pressedBy = HashMap<String, Int>()

    private fun press(b: Btn, pid: Int) {
        b.pressed = true; pressedBy[b.id] = pid
        when (b.id) {
            "attack" -> engine.attackHeld = true
            "jump" -> engine.wantJump = true
            "use" -> engine.post { if (engine.targetPrompt()?.startsWith("Search") == true) engine.interact() else engine.useHeld() }
            "crouch" -> engine.player.crouching = !engine.player.crouching
            "light" -> engine.post { engine.toggleFlashlight() }
            "pause" -> { engine.sound.play("ui_click", 0.5f); callbacks.onPauseMenu() }
            "inv" -> { engine.sound.play("ui_open", 0.5f); callbacks.onOpenInventory() }
            "skill" -> { engine.sound.play("ui_open", 0.5f); callbacks.onOpenSkills() }
        }
    }

    private fun release(b: Btn) {
        b.pressed = false; pressedBy.remove(b.id)
        if (b.id == "attack") engine.attackHeld = false
    }

    private fun updateJoystick() {
        val dx = joyX - joyBaseX; val dy = joyY - joyBaseY
        val maxR = dp(56f)
        val d = sqrt(dx * dx + dy * dy)
        val nx = if (d > 0.01f) dx / d else 0f
        val ny = if (d > 0.01f) dy / d else 0f
        val mag = min(1f, d / maxR)
        engine.moveX = nx * mag
        engine.moveZ = -ny * mag
        // push far past the rim to sprint — one thumb, no extra button
        engine.player.sprinting = d > maxR * 1.55f && -ny > 0.5f && engine.player.stamina > 1f
    }

    // ------------------------------------------------------------ drawing

    override fun onDraw(c: Canvas) {
        if (w == 0f) return
        val player = engine.player
        val env = engine.env

        drawVignette(c)
        drawCrosshair(c)
        drawVitals(c)
        drawCompass(c)
        drawClock(c)
        drawXp(c)
        drawHotbar(c)
        drawButtons(c)
        drawJoystick(c)
        drawPrompt(c)
        drawToast(c)
    }

    private fun drawVignette(c: Canvas) {
        val player = engine.player
        val dmg = player.damageFlash
        val lowHp = (1f - player.health / 40f).coerceIn(0f, 1f)
        val a = ((dmg * 0.55f + lowHp * 0.35f) * 255).toInt().coerceIn(0, 200)
        if (a > 4) {
            p.shader = RadialGradient(w / 2, h / 2, w * 0.7f,
                0x00000000, Color.argb(a, 120, 10, 8), Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, w, h, p)
            p.shader = null
        }
        // indoors the walls close in — a heavier frame than open street
        if (engine.indoors) {
            p.shader = RadialGradient(w / 2, h / 2, w * 0.62f,
                0x00000000, 0xCC000000.toInt(), Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, w, h, p)
            p.shader = null
        }

        // infection creep — sickly green edges
        if (player.infection > 25f) {
            val ia = ((player.infection - 25f) / 75f * 120).toInt().coerceIn(0, 120)
            p.shader = RadialGradient(w / 2, h / 2, w * 0.75f,
                0x00000000, Color.argb(ia, 60, 90, 40), Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, w, h, p)
            p.shader = null
        }
    }

    private fun drawCrosshair(c: Canvas) {
        p.color = 0xAAC9C6BC.toInt()
        p.strokeWidth = dp(1.5f)
        p.style = Paint.Style.STROKE
        val s = dp(7f)
        c.drawLine(w / 2 - s, h / 2, w / 2 - s * 0.35f, h / 2, p)
        c.drawLine(w / 2 + s * 0.35f, h / 2, w / 2 + s, h / 2, p)
        c.drawLine(w / 2, h / 2 - s, w / 2, h / 2 - s * 0.35f, p)
        c.drawLine(w / 2, h / 2 + s * 0.35f, w / 2, h / 2 + s, p)
        // mining progress ring
        if (engine.mineProgress > 0.01f) {
            p.color = UiKit.WARN
            p.strokeWidth = dp(3f)
            val r = dp(14f)
            c.drawArc(w / 2 - r, h / 2 - r, w / 2 + r, h / 2 + r, -90f, engine.mineProgress * 360f, false, p)
        }
        p.style = Paint.Style.FILL
    }

    private fun bar(c: Canvas, x: Float, y: Float, wd: Float, ht: Float, frac: Float, color: Int, icon: String) {
        p.style = Paint.Style.FILL
        p.color = 0x99141412.toInt()
        c.drawRect(x, y, x + wd, y + ht, p)
        p.color = color
        c.drawRect(x, y, x + wd * frac.coerceIn(0f, 1f), y + ht, p)
        p.style = Paint.Style.STROKE
        p.strokeWidth = dp(1f)
        p.color = UiKit.EDGE
        c.drawRect(x, y, x + wd, y + ht, p)
        p.style = Paint.Style.FILL
        tp.textSize = ht * 0.72f
        tp.color = 0xFFDDDACF.toInt()
        tp.textAlign = Paint.Align.LEFT
        c.drawText(icon, x + dp(3f), y + ht * 0.78f, tp)
        tp.textAlign = Paint.Align.CENTER
    }

    private fun drawVitals(c: Canvas) {
        val player = engine.player
        val x = dp(14f); var y = dp(14f)
        val bw = dp(150f); val bh = dp(13f); val gap = dp(4f)
        bar(c, x, y, bw, bh, player.health / player.maxHealth, 0xCC8A2E2A.toInt(), "♥"); y += bh + gap
        bar(c, x, y, bw, bh, player.hunger / 100f, 0xCC9C7C3C.toInt(), "◆"); y += bh + gap
        bar(c, x, y, bw, bh, player.thirst / 100f, 0xCC3C6C9C.toInt(), "≈"); y += bh + gap
        bar(c, x, y, bw, bh, player.stamina / 100f, 0xCC5E7D53.toInt(), "»"); y += bh + gap
        if (player.infection > 0.5f) {
            bar(c, x, y, bw, bh, player.infection / 100f, 0xCC6E8E46.toInt(), "☣")
        }
    }

    private fun drawCompass(c: Canvas) {
        if (engine.player.inventory.count(Items.COMPASS) == 0) return
        val cw = dp(220f); val x0 = (w - cw) / 2; val y0 = dp(10f)
        p.color = 0x88141412.toInt(); p.style = Paint.Style.FILL
        c.drawRect(x0, y0, x0 + cw, y0 + dp(22f), p)
        val yawDeg = Math.toDegrees(engine.player.yaw.toDouble()).toFloat()
        tp.textSize = dp(12f)
        val marks = listOf(0f to "N", 45f to "NE", 90f to "E", 135f to "SE", 180f to "S", 225f to "SW", 270f to "W", 315f to "NW")
        for ((deg, name) in marks) {
            var rel = (deg - yawDeg) % 360f
            if (rel > 180f) rel -= 360f
            if (rel < -180f) rel += 360f
            if (abs(rel) < 60f) {
                val mx = x0 + cw / 2 + rel / 60f * (cw / 2)
                tp.color = if (name.length == 1) UiKit.TEXT else UiKit.TEXT_DIM
                c.drawText(name, mx, y0 + dp(16f), tp)
            }
        }
        p.color = UiKit.ACCENT
        c.drawRect(w / 2 - dp(1f), y0, w / 2 + dp(1f), y0 + dp(22f), p)
    }

    private fun drawClock(c: Canvas) {
        tp.textSize = dp(13f)
        tp.color = UiKit.TEXT
        tp.textAlign = Paint.Align.RIGHT
        c.drawText("${engine.env.clockString()}  DAY ${engine.env.dayCount + 1}", w - dp(190f), dp(30f), tp)
        tp.textAlign = Paint.Align.CENTER
    }

    private fun drawXp(c: Canvas) {
        val player = engine.player
        val x = dp(14f); val y = dp(14f) + (dp(13f) + dp(4f)) * 5 + dp(6f)
        val bw = dp(150f); val bh = dp(6f)
        val cur = com.voxeland.game.progression.Skills.xpForLevel(player.level)
        val next = com.voxeland.game.progression.Skills.xpForLevel(player.level + 1)
        val frac = ((player.xp - cur).toFloat() / (next - cur).coerceAtLeast(1)).coerceIn(0f, 1f)
        p.style = Paint.Style.FILL; p.color = 0x99141412.toInt()
        c.drawRect(x, y, x + bw, y + bh, p)
        p.color = 0xCC7A6FA0.toInt()
        c.drawRect(x, y, x + bw * frac, y + bh, p)
        tp.textSize = dp(10f); tp.color = UiKit.TEXT_DIM
        tp.textAlign = Paint.Align.LEFT
        val pts = if (player.skillPoints > 0) "  ● ${player.skillPoints} pts" else ""
        c.drawText("LV ${player.level}$pts", x, y + bh + dp(12f), tp)
        tp.textAlign = Paint.Align.CENTER
    }

    private fun drawHotbar(c: Canvas) {
        val inv = engine.player.inventory
        for (i in 0 until 5) {
            val r = hotbarRects[i]
            p.style = Paint.Style.FILL
            p.color = if (i == inv.selected) 0xCC2A2A26.toInt() else 0x88141412.toInt()
            c.drawRect(r, p)
            p.style = Paint.Style.STROKE
            p.strokeWidth = dp(if (i == inv.selected) 2.5f else 1f)
            p.color = if (i == inv.selected) 0xFF8A8578.toInt() else UiKit.EDGE
            c.drawRect(r, p)
            p.style = Paint.Style.FILL
            val s = inv.slots[i]
            if (s != null) {
                UiKit.drawItemIcon(c, r, s.item, p)
                if (s.count > 1) {
                    tp.textSize = dp(10f); tp.color = UiKit.TEXT
                    tp.textAlign = Paint.Align.RIGHT
                    c.drawText("${s.count}", r.right - dp(3f), r.bottom - dp(4f), tp)
                    tp.textAlign = Paint.Align.CENTER
                }
            }
        }
        // held item name above bar
        val held = inv.held()
        if (held != null) {
            tp.textSize = dp(11f); tp.color = UiKit.TEXT_DIM
            c.drawText(held.item.name, w / 2, hotbarRects[0].top - dp(8f), tp)
        }
    }

    private fun drawButtons(c: Canvas) {
        for (b in buttons) {
            val round = b == btnAttack || b == btnUse || b == btnJump
            p.style = Paint.Style.FILL
            p.color = when {
                b.pressed -> 0xCC4A3A34.toInt()
                b == btnAttack -> 0x995A2622.toInt()
                else -> 0x8823231F.toInt()
            }
            if (b == btnCrouch && engine.player.crouching) p.color = 0xCC46543E.toInt()
            if (b == btnLight && engine.player.flashlightOn) p.color = 0xCC6E6236.toInt()
            if (round) c.drawCircle(b.rect.centerX(), b.rect.centerY(), b.rect.width() / 2, p)
            else c.drawRoundRect(b.rect, dp(6f), dp(6f), p)
            p.style = Paint.Style.STROKE; p.strokeWidth = dp(1.5f); p.color = 0xAA55534B.toInt()
            if (round) c.drawCircle(b.rect.centerX(), b.rect.centerY(), b.rect.width() / 2, p)
            else c.drawRoundRect(b.rect, dp(6f), dp(6f), p)
            p.style = Paint.Style.FILL
            tp.textSize = dp(12f); tp.color = UiKit.TEXT
            c.drawText(b.label, b.rect.centerX(), b.rect.centerY() + dp(4f), tp)
        }
        // battery charge along the base of the lamp button
        if (engine.player.hasFlashlight()) {
            val r = btnLight.rect
            val frac = (engine.player.battery / 100f).coerceIn(0f, 1f)
            p.style = Paint.Style.FILL
            p.color = 0x88141412.toInt()
            c.drawRect(r.left, r.bottom - dp(4f), r.right, r.bottom, p)
            p.color = if (frac < 0.2f) UiKit.ACCENT else 0xCC9C7C3C.toInt()
            c.drawRect(r.left, r.bottom - dp(4f), r.left + r.width() * frac, r.bottom, p)
        }

        // context ring on USE when something is searchable
        if (engine.targetHint) {
            p.style = Paint.Style.STROKE; p.strokeWidth = dp(2.5f); p.color = UiKit.WARN
            c.drawCircle(btnUse.rect.centerX(), btnUse.rect.centerY(), btnUse.rect.width() / 2 + dp(3f), p)
            p.style = Paint.Style.FILL
        }
    }

    private fun drawJoystick(c: Canvas) {
        if (joyPointer == -1) {
            tp.textSize = dp(10f); tp.color = 0x6677746C
            c.drawText("MOVE — hold & push up to sprint", w * 0.2f, h - dp(40f), tp)
            return
        }
        p.style = Paint.Style.STROKE; p.strokeWidth = dp(2f); p.color = 0x8877746C.toInt()
        c.drawCircle(joyBaseX, joyBaseY, dp(56f), p)
        p.style = Paint.Style.FILL
        p.color = if (engine.player.sprinting) 0xAA5E7D53.toInt() else 0xAA55534B.toInt()
        val dx = joyX - joyBaseX; val dy = joyY - joyBaseY
        val d = sqrt(dx * dx + dy * dy)
        val cl = min(d, dp(70f))
        val nx = if (d > 1f) dx / d else 0f; val ny = if (d > 1f) dy / d else 0f
        c.drawCircle(joyBaseX + nx * cl, joyBaseY + ny * cl, dp(24f), p)
    }

    private fun drawPrompt(c: Canvas) {
        val prompt = lastPrompt ?: return
        tp.textSize = dp(13f); tp.color = UiKit.TEXT
        c.drawText(prompt, w / 2, h / 2 + dp(36f), tp)
    }

    private fun drawToast(c: Canvas) {
        val t = callbacks.toastText() ?: return
        tp.textSize = dp(12f); tp.color = 0xFFCFCCC0.toInt()
        p.style = Paint.Style.FILL; p.color = 0xAA141412.toInt()
        val tw = tp.measureText(t)
        c.drawRect(w / 2 - tw / 2 - dp(10f), h - dp(96f), w / 2 + tw / 2 + dp(10f), h - dp(72f), p)
        c.drawText(t, w / 2, h - dp(80f), tp)
    }

    // prompt polling (cheap, done on HUD tick from game state)
    private var lastPrompt: String? = null
    private var promptCounter = 0
    override fun invalidate() {
        if (++promptCounter % 4 == 0) {
            lastPrompt = try { engine.targetPrompt() } catch (e: Exception) { null }
            engine.targetHint = lastPrompt?.startsWith("Search") == true
        }
        super.invalidate()
    }
}
