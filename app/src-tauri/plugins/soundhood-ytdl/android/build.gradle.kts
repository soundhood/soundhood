import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.mgmat.soundhood.ytdl"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        // Applied by R8 when the app's release is minified (Tauri 2.12 plugin layout).
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_1_8
    }
}

dependencies {
    val youtubedlAndroid = "0.18.1"
    implementation("io.github.junkfood02.youtubedl-android:library:$youtubedlAndroid")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:$youtubedlAndroid")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    implementation(project(":tauri-android"))
}
