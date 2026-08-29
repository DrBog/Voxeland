package com.voxeland.game.ui

import android.annotation.SuppressLint
import android.content.Context
import android.text.InputFilter
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.voxeland.game.progression.Character

/**
 * Menus are built in code and must survive any density and a short
 * landscape viewport: every size goes through [UiKit.dp], rows size
 * themselves with weights (never fixed pixel widths), and the primary
 * action is pinned so it can never be pushed off-screen.
 */
object MenuViews {

    private const val MAX_CONTENT_DP = 640f

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
            setPadding(UiKit.dp(ctx, 24f), UiKit.dp(ctx, 16f), UiKit.dp(ctx, 24f), UiKit.dp(ctx, 16f))
        }
        col.addView(UiKit.title(ctx, "V O X E L A N D", 34f).apply {
            maxLines = 1
            isSingleLine = true
        })
        col.addView(UiKit.label(ctx, "the city stopped breathing. you didn't.", 12f, UiKit.TEXT_DIM).apply {
            gravity = Gravity.CENTER
        })
        col.addView(UiKit.vspace(ctx, UiKit.dp(ctx, 30f)))

        val btnW = UiKit.dp(ctx, 300f)
        if (hasSave) {
            col.addView(UiKit.button(ctx, "CONTINUE", accent = true) { onContinue() },
                LinearLayout.LayoutParams(btnW, LinearLayout.LayoutParams.WRAP_CONTENT))
            col.addView(UiKit.vspace(ctx, UiKit.dp(ctx, 10f)))
        }
        col.addView(UiKit.button(ctx, "NEW GAME", accent = !hasSave) { onNewGame() },
            LinearLayout.LayoutParams(btnW, LinearLayout.LayoutParams.WRAP_CONTENT))
        if (hasSave) {
            col.addView(UiKit.label(ctx, "starting over abandons your survivor", 10f, 0xFF54524A.toInt()).apply {
                gravity = Gravity.CENTER
            })
        }
        col.addView(UiKit.vspace(ctx, UiKit.dp(ctx, 18f)))
        col.addView(UiKit.label(ctx,
            "survive · scavenge · barricade · the dark makes them bold", 10f, 0xFF54524A.toInt()).apply {
            gravity = Gravity.CENTER
        })

        // fillViewport + centre gravity: centred when it fits, scrollable when it doesn't
        col.gravity = Gravity.CENTER_HORIZONTAL or Gravity.CENTER_VERTICAL
        val scroll = ScrollView(ctx).apply { isFillViewport = true }
        scroll.addView(col, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        root.addView(scroll, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        return root
    }

    /** Character creation — required gate on every fresh save. */
    @SuppressLint("SetTextI18n")
    fun characterCreation(ctx: Context, onDone: (Character) -> Unit): FrameLayout {
        val root = FrameLayout(ctx)
        root.setBackgroundColor(0xFF0D0D0C.toInt())

        var body = 1; var skin = 0; var hair = 0; var bg = 0

        val barH = UiKit.dp(ctx, 58f)

        val col = LinearLayout(ctx).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(UiKit.dp(ctx, 20f), UiKit.dp(ctx, 12f), UiKit.dp(ctx, 20f), barH)
        }

        col.addView(UiKit.title(ctx, "WHO WERE YOU BEFORE?", 17f).apply {
            maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        col.addView(UiKit.vspace(ctx, UiKit.dp(ctx, 10f)))

        val name = EditText(ctx).apply {
            hint = "name"
            setText("Riley")
            setTextColor(UiKit.TEXT)
            setHintTextColor(UiKit.TEXT_DIM)
            textSize = 15f
            typeface = UiKit.mono
            gravity = Gravity.CENTER
            isSingleLine = true
            // keep the landscape keyboard from swallowing the whole screen
            imeOptions = EditorInfo.IME_FLAG_NO_EXTRACT_UI or EditorInfo.IME_ACTION_DONE
            setBackgroundColor(0xFF1C1C19.toInt())
            setPadding(UiKit.dp(ctx, 12f), UiKit.dp(ctx, 10f), UiKit.dp(ctx, 12f), UiKit.dp(ctx, 10f))
            filters = arrayOf(InputFilter.LengthFilter(14))
        }
        col.addView(name, LinearLayout.LayoutParams(UiKit.dp(ctx, 260f), LinearLayout.LayoutParams.WRAP_CONTENT))
        col.addView(UiKit.vspace(ctx, UiKit.dp(ctx, 12f)))

        /**
         * One option cycler. The value fills the row by weight — the arrows
         * get fixed, thumb-sized boxes — so long values never get squeezed
         * into a vertical letter column.
         */
        fun cycler(
            label: String,
            options: List<String>,
            descs: List<String>?,
            get: () -> Int,
            set: (Int) -> Unit,
        ): LinearLayout {
            val box = LinearLayout(ctx).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(UiKit.dp(ctx, 4f), UiKit.dp(ctx, 4f), UiKit.dp(ctx, 4f), UiKit.dp(ctx, 8f))
            }
            box.addView(UiKit.label(ctx, label, 10f, UiKit.TEXT_DIM).apply {
                gravity = Gravity.CENTER
                letterSpacing = 0.15f
            }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

            val row = LinearLayout(ctx).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
            }
            val value = TextView(ctx).apply {
                setTextColor(UiKit.TEXT)
                textSize = 15f
                typeface = UiKit.mono
                gravity = Gravity.CENTER
                isSingleLine = true
                ellipsize = android.text.TextUtils.TruncateAt.END
            }
            val desc = UiKit.label(ctx, "", 10f, UiKit.TEXT_DIM).apply {
                gravity = Gravity.CENTER
                maxLines = 2
            }
            fun refresh() {
                value.text = options[get()]
                desc.text = descs?.get(get()) ?: ""
            }
            val arrowW = UiKit.dp(ctx, 46f)
            val arrowMin = UiKit.dp(ctx, 38f)
            fun arrow(label: String, step: Int) =
                UiKit.button(ctx, label, compact = true) {
                    set((get() + options.size + step) % options.size); refresh()
                }.apply { minimumHeight = arrowMin; minHeight = arrowMin }
            row.addView(arrow("<", -1),
                LinearLayout.LayoutParams(arrowW, LinearLayout.LayoutParams.WRAP_CONTENT))
            row.addView(value, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(arrow(">", 1),
                LinearLayout.LayoutParams(arrowW, LinearLayout.LayoutParams.WRAP_CONTENT))

            refresh()
            box.addView(row, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            box.addView(desc, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            return box
        }

        // two weighted columns keep the four choices on one landscape screen
        fun column(vararg children: View): LinearLayout {
            val c = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
            for (v in children) c.addView(v, LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
            return c
        }

        val grid = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
        val left = column(
            cycler("BUILD", Character.BODIES, Character.BODY_DESC, { body }, { body = it }),
            cycler("SKIN", Character.TONES, null, { skin }, { skin = it }),
        )
        val right = column(
            cycler("HAIR", Character.HAIR, null, { hair }, { hair = it }),
            cycler("PAST LIFE", Character.BACKGROUNDS, Character.BACKGROUND_DESC, { bg }, { bg = it }),
        )
        grid.addView(left, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        grid.addView(right, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        // cap the width on wide screens, but never exceed a narrow one (that
        // pushed the grid off the left edge on short, dense phones)
        val availDp = ctx.resources.configuration.screenWidthDp - 48
        val gridW = if (availDp >= MAX_CONTENT_DP) UiKit.dp(ctx, MAX_CONTENT_DP)
                    else LinearLayout.LayoutParams.MATCH_PARENT
        col.addView(grid, LinearLayout.LayoutParams(gridW, LinearLayout.LayoutParams.WRAP_CONTENT))

        val scroll = ScrollView(ctx).apply {
            isFillViewport = true
            clipToPadding = false
        }
        scroll.addView(col, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))
        root.addView(scroll, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // pinned action bar — WAKE UP is always reachable, whatever the viewport
        val bar = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setBackgroundColor(0xF00D0D0C.toInt())
            setPadding(0, UiKit.dp(ctx, 6f), 0, UiKit.dp(ctx, 8f))
        }
        bar.addView(UiKit.button(ctx, "WAKE UP", accent = true) {
            val n = name.text.toString().trim().ifEmpty { "Stranger" }
            onDone(Character(n, body, skin, hair, bg))
        }, LinearLayout.LayoutParams(UiKit.dp(ctx, 300f), LinearLayout.LayoutParams.WRAP_CONTENT))
        root.addView(bar, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM))

        return root
    }
}
