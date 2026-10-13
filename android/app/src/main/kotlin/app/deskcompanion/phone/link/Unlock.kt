package app.deskcompanion.phone.link

import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * The check before Allow: fingerprint or face, or the screen lock as the
 * fallback. A phone with no screen lock at all can't be asked, so there Allow
 * goes straight through (the PC link is still the only way to reach it).
 */
object Unlock {
    private const val METHODS = BIOMETRIC_STRONG or DEVICE_CREDENTIAL

    fun available(activity: FragmentActivity): Boolean =
        BiometricManager.from(activity).canAuthenticate(METHODS) == BiometricManager.BIOMETRIC_SUCCESS

    fun ask(activity: FragmentActivity, title: String, onOk: () -> Unit) {
        if (!available(activity)) {
            onOk()
            return
        }
        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onOk()

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    // Cancelled by the user is not worth a message.
                    if (errorCode != BiometricPrompt.ERROR_USER_CANCELED && errorCode != BiometricPrompt.ERROR_NEGATIVE_BUTTON) {
                        Toast.makeText(activity, "Couldn't check it's you: $errString", Toast.LENGTH_SHORT).show()
                    }
                }
            },
        )
        prompt.authenticate(
            BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("Confirm it's you")
                .setAllowedAuthenticators(METHODS)
                .build(),
        )
    }
}
