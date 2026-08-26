package com.voxeland.game.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.SoundPool

/**
 * All audio is procedurally generated WAVs shipped in assets/sounds
 * (see tools/gen_assets.py). Short effects go through SoundPool; the
 * four ambient beds run as looping MediaPlayers whose volumes are
 * cross-mixed continuously from the environment state.
 */
class SoundManager(private val ctx: Context) {
    private val pool = SoundPool.Builder()
        .setMaxStreams(10)
        .setAudioAttributes(
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        ).build()

    private val ids = HashMap<String, Int>()
    private val loaded = HashSet<Int>()
    private val ambient = HashMap<String, MediaPlayer>()
    var sfxVolume = 1f
    var ambVolume = 1f

    init {
        pool.setOnLoadCompleteListener { _, sampleId, status -> if (status == 0) loaded.add(sampleId) }
        val sfx = listOf(
            "zombie_groan1", "zombie_groan2", "zombie_groan3", "zombie_alert", "zombie_attack", "zombie_die",
            "step_concrete1", "step_concrete2", "step_dirt1", "step_dirt2",
            "hit_flesh", "hit_block", "block_break", "block_place",
            "player_hurt1", "player_hurt2", "player_die", "heartbeat",
            "eat", "drink", "bandage", "craft", "pickup", "container_open",
            "ui_click", "ui_open", "level_up", "skill_unlock",
            "shake_crank", "light_click",
        )
        for (name in sfx) {
            try {
                ctx.assets.openFd("sounds/$name.wav").use { fd ->
                    ids[name] = pool.load(fd, 1)
                }
            } catch (_: Exception) { /* missing asset — stay silent, not crashed */ }
        }
        for (name in listOf("amb_wind", "amb_city", "amb_night", "amb_interior")) {
            try {
                val fd = ctx.assets.openFd("sounds/$name.wav")
                val mp = MediaPlayer()
                mp.setDataSource(fd.fileDescriptor, fd.startOffset, fd.length)
                fd.close()
                mp.isLooping = true
                mp.setVolume(0f, 0f)
                mp.prepare()
                ambient[name] = mp
            } catch (_: Exception) { }
        }
    }

    fun play(name: String, volume: Float = 1f, rate: Float = 1f) {
        val id = ids[name] ?: return
        if (id !in loaded) return
        val v = (volume * sfxVolume).coerceIn(0f, 1f)
        pool.play(id, v, v, 1, 0, rate.coerceIn(0.5f, 2f))
    }

    fun startAmbient() { for (mp in ambient.values) try { if (!mp.isPlaying) mp.start() } catch (_: Exception) {} }
    fun pauseAmbient() { for (mp in ambient.values) try { if (mp.isPlaying) mp.pause() } catch (_: Exception) {} }

    fun mixAmbient(wind: Float, city: Float, night: Float, interior: Float) {
        setAmb("amb_wind", wind); setAmb("amb_city", city)
        setAmb("amb_night", night); setAmb("amb_interior", interior)
    }

    private fun setAmb(name: String, v: Float) {
        val vol = (v * ambVolume).coerceIn(0f, 1f)
        try { ambient[name]?.setVolume(vol, vol) } catch (_: Exception) {}
    }

    fun release() {
        pool.release()
        for (mp in ambient.values) try { mp.release() } catch (_: Exception) {}
        ambient.clear()
    }
}
