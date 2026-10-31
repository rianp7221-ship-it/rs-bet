# App Android (TWA)

Abre https://www.realsports.online (o domínio sem www redireciona com 308, e o Android não segue redirect ao verificar o assetlinks) em tela cheia pelo Chrome (Trusted Web Activity), com WebView como reserva.
O APK publicado fica em `/app/realsports.apk` e a verificação do domínio em `/.well-known/assetlinks.json`.

## Gerar nova versão
1. Aumente `versionCode`/`versionName` em `app/build.gradle`.
2. A chave de assinatura fica no Supabase Storage, bucket privado `internal`, arquivo `android/android-signing.tgz` (`realsports.jks` + `pass.txt`). Sem ela, atualizações não instalam por cima.
3. `RS_KEYSTORE=/caminho/realsports.jks RS_KEYSTORE_PASS=$(cat pass.txt) ./gradlew assembleRelease`
4. Copie `app/build/outputs/apk/release/app-release.apk` para `../app/realsports.apk`.
