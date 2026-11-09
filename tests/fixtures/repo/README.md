# A frozen copy of the data, for the tests

`devices/`, `genres/`, `games/`, `templates/` and `dist/` as they stood when this copy was
taken. Every test runs against this folder (`AZERON_DATA`, set in `vitest.config.ts`, the
smoke tests and the Playwright config), never against the real folders at the repo root.

The real layouts are edited from the editor all day and saved as they are edited. A test
written against them fails whenever a layout is half way through a change, which says
nothing about the code. This copy only changes when someone changes it on purpose.

Two things differ from the real data: `games/SpaceSims/everspace/game.yaml` points
`ingame_config` at a path that does not exist, so no test can read or write a real game's
files, and this note.

To take a fresh copy from what is committed, in WSL:

```sh
rm -rf tests/fixtures/repo/{devices,genres,games,templates,dist}
git archive HEAD devices genres games templates dist | tar -x -C tests/fixtures/repo
```

or in PowerShell. It goes through a file because Windows PowerShell mangles binary piped
between programs; `tar` ships with Windows:

```powershell
"devices","genres","games","templates","dist" | ForEach-Object { Remove-Item -Recurse -Force "tests/fixtures/repo/$_" }
git archive -o fixture.tar HEAD devices genres games templates dist
tar -xf fixture.tar -C tests/fixtures/repo; Remove-Item fixture.tar
```

and put the `ingame_config` line back. The real `game.yaml` names the file by
`${LOCALAPPDATA}`, which finds the game on whatever computer runs the tests. Left in, the
tests would read the owner's real game. Expect tests that describe the layout to need
bringing up to date: that is the point of doing it deliberately.
