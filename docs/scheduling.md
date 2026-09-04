# Running the sweep on a schedule

The sweep is an agent session, not a script: any coding agent that can read the instance
directory runs it. `antifeed prompt` prints the kickoff prompt, so scheduling is one line.

```bash
cd /path/to/my-antifeed && claude -p "$(npx antifeed prompt)"        # Claude Code
cd /path/to/my-antifeed && codex exec "$(npx antifeed prompt)"       # Codex CLI
```

Always run from the instance directory (the engine resolves everything against the cwd, or
`WALL_HOME`). The agent needs the same environment a person would: `.env` for the hosted wall,
and the CDP browser open (`antifeed browser`) if X / Instagram are in scope.

## cron (macOS / Linux)

```cron
# every 4 hours, logging into the instance directory
0 */4 * * * cd /path/to/my-antifeed && claude -p "$(npx antifeed prompt)" >> sweep.log 2>&1
```

## launchd (macOS)

Save as `~/Library/LaunchAgents/com.antifeed.sweep.plist`, then
`launchctl load ~/Library/LaunchAgents/com.antifeed.sweep.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.antifeed.sweep</string>
  <key>ProgramArguments</key><array>
    <string>/bin/bash</string><string>-lc</string>
    <string>cd /path/to/my-antifeed && claude -p "$(npx antifeed prompt)"</string>
  </array>
  <key>StartInterval</key><integer>14400</integer>
  <key>StandardOutPath</key><string>/path/to/my-antifeed/sweep.log</string>
  <key>StandardErrorPath</key><string>/path/to/my-antifeed/sweep.log</string>
</dict></plist>
```

## Windows

Task Scheduler → Basic Task → run a small `sweep.cmd` in the instance directory:

```bat
@echo off
cd /d C:\path\to\my-antifeed
for /f "delims=" %%p in ('npx antifeed prompt') do set PROMPT=%%p
codex exec "%PROMPT%"
```

## Agent-native schedulers

Claude Code's scheduled tasks and similar agent-side schedulers work too — point the task at
the instance directory and its `AGENTS.md`. Nothing in the engine depends on which scheduler
fired the sweep; repeat runs in a day are fine (the contract asks the agent to report
saturation rather than pad).
