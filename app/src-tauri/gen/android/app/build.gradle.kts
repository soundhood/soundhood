import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// Soundhood release signing (re-applied by scripts/patch-android.py). Every APK installed on the phone
// must carry the same key: Android refuses an update signed with another one, and uninstalling wipes
// the app's data. The key stays outside the repo, described by a keystore.properties file (storeFile,
// storePassword, keyAlias, keyPassword; a relative storeFile is relative to that file) found at
// $SOUNDHOOD_KEYSTORE_PROPERTIES, else <user home>/.soundhood/keystore.properties. Without that file
// the release is signed with this machine's Android debug key, which signed the builds installed so far.
val soundhoodKeystoreFile: File = providers.environmentVariable("SOUNDHOOD_KEYSTORE_PROPERTIES").orNull
    ?.takeIf { it.isNotBlank() }
    ?.let { File(it) }
    ?: File(
        providers.environmentVariable("USERPROFILE").orNull ?: System.getProperty("user.home"),
        ".soundhood/keystore.properties"
    )
val soundhoodKeystore: Properties? = soundhoodKeystoreFile.takeIf { it.isFile }?.let { f ->
    Properties().apply { f.inputStream().use { load(it) } }
}
if (soundhoodKeystore == null) {
    val note = "Soundhood: $soundhoodKeystoreFile not found, so the release APK is signed with " +
        "this machine's Android debug key (~/.android/debug.keystore)"
    logger.warn("w: $note")
    // Configuration-cache hits skip the line above; say it again when a release is packaged.
    tasks.configureEach {
        if (name.startsWith("package") && name.endsWith("Release")) {
            doFirst { logger.warn("w: $note") }
        }
    }
}

android {
    compileSdk = 36
    namespace = "com.mgmat.soundhood"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.mgmat.soundhood"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        soundhoodKeystore?.let { ks ->
            create("release") {
                val missing = listOf("storeFile", "storePassword", "keyAlias", "keyPassword")
                    .filter { ks.getProperty(it).isNullOrBlank() }
                if (missing.isNotEmpty()) {
                    throw GradleException("$soundhoodKeystoreFile lacks ${missing.joinToString()}")
                }
                storeFile = soundhoodKeystoreFile.parentFile.resolve(ks.getProperty("storeFile"))
                storePassword = ks.getProperty("storePassword")
                keyAlias = ks.getProperty("keyAlias")
                keyPassword = ks.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {
                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            optimization {
               enable = true
            }
            proguardFiles(
                *fileTree(".") {
                  include("**/*.pro")
                  exclude("build/**")
                }.files.toTypedArray()
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    buildFeatures {
        buildConfig = true
    }
    // youtubedl-android runs python/ffmpeg as executables: the .so files must exist on disk, not stay inside the APK
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = file("tauri.build.gradle.kts"))
