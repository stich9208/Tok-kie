Write-Output @'
Tok-kie cloud setup is completed inside the Electron app.

1. Enable anonymous sign-ins in the Supabase project.
2. Start Tok-kie and open Cloud settings.
3. Enter the project URL and public key to generate digest-only setup SQL.
4. Run the full SQL block in SQL Editor, then confirm once in the app.

This compatibility script never asks for or writes cloud secrets.
'@
