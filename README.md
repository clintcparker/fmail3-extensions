# fmail3-extensions

Custom JavaScript and CSS extensions for [FMail3](https://fmail3.appmac.fr) — a sandboxed macOS wrapper around Fastmail.

**Requirements:** macOS 15 (Sequoia) · FMail3 ≥ 1.2.4

---

## Extensions

### Date-range picker (`fm3-daterange.js` + `fm3-daterange.css`)

Adds a calendar icon to Fastmail's search bar. Click it to open a two-month date picker and insert a `date:YYYY-MM-DD..YYYY-MM-DD` search filter automatically.

---

## Install

```bash
git clone https://github.com/clintcparker/fmail3-extensions.git \
  "$HOME/Library/Containers/fr.arievanboxel.FMail3/Data/Documents/Scripts"
```

If FMail3 has already created the `Scripts` folder (it usually has), use this instead:

```bash
SCRIPTS="$HOME/Library/Containers/fr.arievanboxel.FMail3/Data/Documents/Scripts"
git clone https://github.com/clintcparker/fmail3-extensions.git "$SCRIPTS.tmp"
rsync -a "$SCRIPTS.tmp/" "$SCRIPTS/"
rm -rf "$SCRIPTS.tmp"
```

### Activate in FMail3

Open FMail3 → **Settings** → **Advanced** and confirm these are checked:

- **js files in this folder run at startup**
- **Inject CSS**

That's it — all `.js` and `.css` files in the Scripts folder are loaded automatically.

---

## Update

Add this alias to your shell config (fish: `~/.config/fish/config.fish`, bash/zsh: `~/.zshrc`):

```bash
# bash / zsh
alias fmail3-update='git -C "$HOME/Library/Containers/fr.arievanboxel.FMail3/Data/Documents/Scripts" pull --ff-only && osascript -e "tell application \"FMail3\" to quit" 2>/dev/null; sleep 1; open -a FMail3'
```

```fish
# fish
abbr --add fmail3-update 'git -C "$HOME/Library/Containers/fr.arievanboxel.FMail3/Data/Documents/Scripts" pull --ff-only; and osascript -e "tell application \"FMail3\" to quit"; sleep 1; open -a FMail3'
```

Then just run:

```
fmail3-update
```

---

## Uninstall an extension

```bash
SCRIPTS="$HOME/Library/Containers/fr.arievanboxel.FMail3/Data/Documents/Scripts"
git -C "$SCRIPTS" rm fm3-daterange.js fm3-daterange.css
```

Then untick the files in FMail3 Settings.

---

## License

MIT
