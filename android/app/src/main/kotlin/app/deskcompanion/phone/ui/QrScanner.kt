package app.deskcompanion.phone.ui

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The camera, looking for a QR code. Reads it on the phone (zxing); nothing
 * is sent anywhere. Calls [onCode] on the main thread for each code seen.
 *
 * Phones differ a lot in what their cameras do, so nothing here is allowed to
 * crash the app: if the camera can't start or stops (no back camera, busy,
 * the permission was taken away, CameraX failing to initialise), [onProblem]
 * says so and the paste option stays available. After the scanner leaves the
 * screen nothing it started calls back.
 */
@Composable
fun QrScanner(onCode: (String) -> Unit, onProblem: (String) -> Unit, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val executor = remember { Executors.newSingleThreadExecutor() }
    val providerFuture = remember { ProcessCameraProvider.getInstance(ctx) }
    // Flipped when the scanner leaves; everything that could arrive late checks it.
    val gone = remember { AtomicBoolean(false) }
    val latestCode by rememberUpdatedState(onCode)
    val latestProblem by rememberUpdatedState(onProblem)

    AndroidView(
        modifier = modifier,
        factory = { c ->
            val view = PreviewView(c).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
            providerFuture.addListener({
                if (gone.get()) return@addListener
                try {
                    val provider = providerFuture.get()
                    val preview = Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }
                    val analysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()
                    val reader = QRCodeReader()
                    analysis.setAnalyzer(executor) { image ->
                        try {
                            if (!gone.get()) decode(image, reader)?.let { text -> view.post { if (!gone.get()) latestCode(text) } }
                        } catch (e: Throwable) {
                            // One bad frame is skipped; the next one is tried.
                        } finally {
                            image.close()
                        }
                    }
                    provider.unbindAll()
                    provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                } catch (e: Throwable) {
                    // ExecutionException from CameraX itself, no back camera, camera in use...
                    if (!gone.get()) latestProblem("The camera couldn't start. Paste the link instead.")
                }
            }, ContextCompat.getMainExecutor(c))
            view
        },
    )
    DisposableEffect(Unit) {
        onDispose {
            gone.set(true)
            try {
                // Stop the frames first, then the camera, then the thread that read them.
                providerFuture.get().unbindAll()
            } catch (e: Throwable) {
            }
            executor.shutdown()
        }
    }
}

private val hints = mapOf(
    DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
    DecodeHintType.TRY_HARDER to true,
)

/** The text of a QR code in the camera frame (its brightness plane), or null. */
private fun decode(image: ImageProxy, reader: QRCodeReader): String? {
    val plane = image.planes.firstOrNull() ?: return null
    val buffer = plane.buffer
    val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
    val rowStride = plane.rowStride
    if (image.width <= 0 || image.height <= 0 || rowStride < image.width || bytes.size < rowStride * (image.height - 1) + image.width) return null
    val source = PlanarYUVLuminanceSource(bytes, rowStride, image.height, 0, 0, image.width, image.height, false)
    return try {
        reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text
    } catch (e: Exception) {
        null
    } finally {
        reader.reset()
    }
}
