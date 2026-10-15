import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The release key: android/keystore.properties (never in git; see docs/RELEASING.md). Without it
// a release build is left unsigned, so a fresh clone still builds.
val keystore = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
// Where this build looks for updates (an https address of android.json), passed in by
// scripts/release.mjs as -PupdateUrl=... Empty (the default) means this build never checks.
val updateUrl = (findProperty("updateUrl") as String?) ?: ""

android {
    namespace = "app.deskcompanion.phone"
    compileSdk = 35
    defaultConfig {
        applicationId = "app.deskcompanion.phone"
        // 11+: the combined fingerprint-or-screen-lock prompt for Allow needs it.
        minSdk = 30
        targetSdk = 35
        versionCode = 8
        versionName = "0.4.3"
        buildConfigField("String", "UPDATE_URL", "\"$updateUrl\"")
    }
    signingConfigs {
        if (keystore.containsKey("storeFile")) {
            create("release") {
                storeFile = file(keystore.getProperty("storeFile"))
                storePassword = keystore.getProperty("storePassword")
                keyAlias = keystore.getProperty("keyAlias")
                keyPassword = keystore.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        release {
            signingConfigs.findByName("release")?.let { signingConfig = it }
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].java.srcDirs("src/main/kotlin")
    sourceSets["test"].java.srcDirs("src/test/kotlin")
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    // Fingerprint or screen-lock check before Allow.
    implementation("androidx.biometric:biometric:1.1.0")
    // Biometric brings an old Fragment whose FragmentActivity refuses the request codes that
    // permission prompts (camera, notifications) use today and crashes; the current one doesn't.
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Scanning the pairing QR code: CameraX shows the camera, zxing-core (pure Java) reads the code. No Google services.
    val cameraX = "1.3.4"
    implementation("androidx.camera:camera-core:$cameraX")
    implementation("androidx.camera:camera-camera2:$cameraX")
    implementation("androidx.camera:camera-lifecycle:$cameraX")
    implementation("androidx.camera:camera-view:$cameraX")
    implementation("com.google.zxing:core:3.5.3")
    // The relay's WebSocket, when the phone isn't on the PC's network.
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // android.jar only has stubs of org.json in JVM tests
}
