# IRONWAKE for Android — scaffold

A standalone Gradle project (deliberately *not* a module of Voxeland) that
wraps `dist/ironwake.html` in a single WebView.

**Status: builds and signs; never launched on a device.** The APK is verified
as far as this environment allows — it packages, it signs, `apksigner verify`
passes, it declares no permissions, and the bundled page is byte-identical to
`dist/ironwake.html`. Nothing here has watched it start.

Two details are load bearing:

- the page is served through `WebViewAssetLoader` on an `https://` origin
  rather than from `file://`, because localStorage on a file origin varies by
  WebView version and the campaign save lives in it;
- the window lays out under the display cutout with the system bars hidden,
  because the board is framed to the space it is given.

No permissions are declared. The whole game is in the package.

```
export ANDROID_HOME=~/android-sdk
echo "sdk.dir=$ANDROID_HOME" > local.properties
cd tactics && node build.mjs && cp dist/ironwake.html android/app/src/main/assets/
cd android && gradle :app:assembleRelease      # debug-signed; sideload only
```
