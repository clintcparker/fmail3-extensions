# FMail3 Extensions

[![License: 0BSD](https://img.shields.io/badge/license-0BSD-blue.svg)](LICENSE)
[![macOS 15+](https://img.shields.io/badge/macOS-15%2B%20Sequoia-000000?logo=apple&logoColor=white)](https://www.apple.com/macos/)
[![FMail3 ≥ 1.2.4](https://img.shields.io/badge/FMail3-%E2%89%A5%201.2.4-3b6ea5)](https://fmail3.appmac.fr)

A collection of small JavaScript & CSS extensions for [FMail3](https://fmail3.appmac.fr) — the
sandboxed macOS wrapper around Fastmail. Each extension is a drop-in `.js` / `.css` pair that
FMail3 loads automatically at startup, adding features Fastmail's web client doesn't have on its own.

Drop the whole repo into FMail3's `Scripts` folder once (see [Install](#install)); every extension
below comes along, and `git pull` brings new ones as they land.

## Extensions

| Extension | What it does | Files |
|-----------|--------------|-------|
| [Date-range picker](#date-range-picker) | Adds a calendar icon to Fastmail's search bar for filtering mail by date range. | `fm3-daterange.js`, `fm3-daterange.css` |

---

## Date-range picker

Adds a calendar icon next to Fastmail's search bar. Click it to open a small **From / To** picker;
choosing a range inserts the matching `after:` / `before:` tokens into the search and runs it. Your
last range is remembered between sessions, and dates use your local time zone.

![The date-range picker open below Fastmail's search bar](https://raw.githubusercontent.com/clintcparker/fmail3-extensions/main/docs/picker.png)

*Click the calendar icon to open the picker, set a range, and hit **Apply**.*

![The resulting after: / before: search tokens applied in Fastmail](https://raw.githubusercontent.com/clintcparker/fmail3-extensions/main/docs/search-result.png)

*Applying a range drops `after:` / `before:` tokens into Fastmail's search and runs it.*

### Examples

**A single day.** Set both **From** and **To** to `2026-06-25`. The picker inserts:

```
after:2026-06-25 before:2026-06-26
```

The **To** date is *inclusive* — `before:` is set to the following day, so mail from the 25th itself
is included rather than cut off at midnight.

**From a date onward.** Set **From** to `2026-01-01` and leave **To** empty:

```
after:2026-01-01
```

Everything on or after January 1st.

**Up to a date.** Leave **From** empty and set **To** to `2026-03-31`:

```
before:2026-04-01
```

Everything up to and including March 31st.

Use **Clear** to remove the date tokens and reset the search.

---

## Install

Clone the repo straight into FMail3's `Scripts` folder:

```bash
git clone https://github.com/clintcparker/fmail3-extensions.git \
  "$HOME/Library/Containers/fr.arievanboxel.FMail3/Data/Documents/Scripts"
```

If FMail3 has already created the `Scripts` folder (it usually has), clone into a temp dir and copy in:

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

That's it — every `.js` and `.css` file in the `Scripts` folder is loaded automatically, so all
extensions in this repo turn on at once. Restart FMail3 to pick them up.

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

Then pull the latest extensions and restart FMail3 with:

```
fmail3-update
```

## Uninstall an extension

Remove its files from the `Scripts` folder:

```bash
SCRIPTS="$HOME/Library/Containers/fr.arievanboxel.FMail3/Data/Documents/Scripts"
git -C "$SCRIPTS" rm fm3-daterange.js fm3-daterange.css
```

Restart FMail3 and the extension is gone.

## License

[0BSD](LICENSE)
