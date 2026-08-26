package com.voxeland.game.ui

import android.annotation.SuppressLint
import android.content.Context
import android.text.InputFilter
import android.view.Gravity
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.voxeland.game.progression.Character

object MenuViews {

    fun mainMenu(
        ctx: Context,
        hasSave: Boolean,
        onContinue: () -> Unit,
        onNewGame: () -> Unit,
    ): FrameLayout {
        val root = FrameLayout(ctx)
        root.setBackgroundColor(0xFF0D0D0C.toInt())
        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        col.addView(UiKit.title(ctx, "V O X E L A N D", 40f))
        col.addView(UiKit.label(ctx, "the city stopped breathing. you didn't.", 13f, UiKit.TEXT_DIM).apply {
            gravity = Gravity.CENTER
        })
        col.addView(UiKit.vspace(ctx, 48))
        if (hasSave) {
            col.addView(UiKit.button(ctx, "CONTINUE", accent = true) { onContinue() },
                LinearLayout.LayoutParams(560, LinearLayout.LayoutParams.WRAP_CONTENT))
            col.addView(UiKit.vspace(ctx, 14))
        }
        col.addView(UiKit.button(ctx, if (hasSave) "NEW GAME (abandons old survivor)" else "NEW GAME", accent = !hasSave) { onNewGame() },
            LinearLayout.LayoutParams(560, LinearLayout.LayoutParams.WRAP_CONTENT))
        col.addView(UiKit.vspace(ctx, 30))
        col.addView(UiKit.label(ctx,
            "survive · scavenge · barricade · the dark makes them bold", 11f, 0xFF54524A.toInt()).apply {
            gravity = Gravity.CENTER
        })
        root.addView(col, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        return root
    }

    /** Character creation — required gate on every fresh save. */
    @SuppressLint("SetTextI18n")
    fun characterCreation(ctx: Context, onDone: (Character) -> Unit): FrameLayout {
        val root = FrameLayout(ctx)
        root.setBackgroundColor(0xFF0D0D0C.toInt())

        var body = 1; var skin = 0; var hair = 0; var bg = 0

        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(48, 24, 48, 24)
        }
        col.addView(UiKit.title(ctx, "WHO WERE YOU, BEFORE?", 20f))
        col.addView(UiKit.vspace(ctx, 18))

        val name = EditText(ctx).apply {
            hint = "name"
            setText("Riley")
            setTextColor(UiKit.TEXT)
            setHintTextColor(UiKit.TEXT_DIM)
            textSize = 15f
            typeface = UiKit.mono
            setBackgroundColor(0xFF1C1C19.toInt())
            setPadding(24, 16, 24, 16)
            filters = arrayOf(InputFilter.LengthFilter(14))
        }
        col.addView(name, LinearLayout.LayoutParams(500, LinearLayout.LayoutParams.WRAP_CONTENT))
        col.addView(UiKit.vspace(ctx, 14))

        fun cycler(label: String, options: List<String>, descs: List<String>?, get: () -> Int, set: (Int) -> Unit): LinearLayout {
            val row = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
            val line = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            val value = TextView(ctx).apply {
                setTextColor(UiKit.TEXT); textSize = 14f; typeface = UiKit.mono; gravity = Gravity.CENTER
            }
            val desc = UiKit.label(ctx, "", 11f, UiKit.TEXT_DIM)
            fun refresh() {
                value.text = "${label}: ${options[get()]}"
                desc.text = descs?.get(get()) ?: ""
            }
            line.addView(UiKit.button(ctx, "<") { set((get() + options.size - 1) % options.size); refresh() })
            line.addView(value, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            line.addView(UiKit.button(ctx, ">") { set((get() + 1) % options.size); refresh() })
            refresh()
            row.addView(line, LinearLayout.LayoutParams(560, LinearLayout.LayoutParams.WRAP_CONTENT))
            row.addView(desc)
            row.setPadding(0, 6, 0, 6)
            return row
        }

        col.addView(cycler("BUILD", Character.BODIES, Character.BODY_DESC, { body }, { body = it }))
        col.addView(cycler("SKIN", Character.TONES, null, { skin }, { skin = it }))
        col.addView(cycler("HAIR", Character.HAIR, null, { hair }, { hair = it }))
        col.addView(cycler("PAST LIFE", Character.BACKGROUNDS, Character.BACKGROUND_DESC, { bg }, { bg = it }))
        col.addView(UiKit.vspace(ctx, 22))
        col.addView(UiKit.button(ctx, "WAKE UP", accent = true) {
            val n = name.text.toString().trim().ifEmpty { "Stranger" }
            onDone(Character(n, body, skin, hair, bg))
        }, LinearLayout.LayoutParams(560, LinearLayout.LayoutParams.WRAP_CONTENT))

        val scroll = ScrollView(ctx)
        scroll.addView(col)
        root.addView(scroll, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER_HORIZONTAL))
        return root
    }
}
