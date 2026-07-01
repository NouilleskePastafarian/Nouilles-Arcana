' Lance un exécutable + argument sans AUCUNE fenêtre visible ni entrée
' dans la barre des tâches (contrairement à "start /min" qui laisse une
' icône réduite). Deux arguments séparés (pas de quoting imbriqué) :
'   wscript.exe //B run-hidden.vbs "<exe>" "<config.json>"
Dim shell, exePath, configPath, cmd
Set shell = CreateObject("WScript.Shell")
exePath = WScript.Arguments(0)
configPath = WScript.Arguments(1)
cmd = Chr(34) & exePath & Chr(34) & " --config " & Chr(34) & configPath & Chr(34)
shell.Run cmd, 0, False
