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
| [Add all to group](#add-all-to-group) | Adds an **Add all to group** item to the People panel's `...` menu, dropping everyone in a conversation into a Fastmail Contacts group. | `fm3-contactgroup.js`, `fm3-contactgroup.css` |

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

## Add all to group

Open a conversation, switch the right-hand panel to **People**, and click the `...` button. Below
**Invite all to new event** there's a new **Add all to group** item. It collects every address the
panel is showing — both *Senders* and *Other recipients*, so it follows whatever the
**In conversation** toggle is set to — and adds them all to a Fastmail Contacts group in one go.

![The People panel's ... menu, with Add all to group below Invite all to new event](https://raw.githubusercontent.com/clintcparker/fmail3-extensions/main/docs/group-menu.png)

*The item sits below **Invite all to new event**. It's built by cloning Fastmail's own menu row, so
it picks up the host styling rather than approximating it.*

Choosing the item opens a small popover listing your existing contact groups, with a filter box and
a **+ New group...** option. Pick one, confirm, and a toast reports what happened:

![The group picker popover, filtering groups with a New group option and an Add button](https://raw.githubusercontent.com/clintcparker/fmail3-extensions/main/docs/group-picker.png)

*Type to filter your groups, or create one on the spot. The button counts the people going in.*

```
Added 4 to Lodge Officers - 2 new contacts created
```

### Behaviour worth knowing

**People who aren't in your Contacts get a card.** A Fastmail group holds contact cards, not loose
addresses, so anyone unknown gets a minimal card (display name + that one address) in your default
address book before being added. The toast tells you how many were created.

**Re-running is safe.** Someone already in the group is counted as "already there" rather than
duplicated, so you can add the same conversation twice without making a mess.

**Partial failures are reported, not silent.** If one address can't be resolved or created, the rest
still go in and the toast names who failed.

**The same person under two addresses becomes two contacts.** Matching is by email address, so if
someone appears in the panel under both a work and a personal address, you get two cards unless one
existing card already lists both.

### Setup: one API token

The first time you use **Add all to group**, it asks for a Fastmail API token. Create one at
**Settings → Privacy & Security → Integrations → New API token**, give it **Contacts** access, and
paste it in. It's stored in `localStorage` and remembered from then on.

Scope the token to Contacts rather than granting it everything — it's kept in browser storage, where
any script running on the Fastmail origin could read it. If you ever want to revoke it, delete it in
Fastmail's Integrations settings; the extension will prompt again next time.

A token that's rejected, or that lacks Contacts access, shows the reason in the popover with an
option to enter a different one.

<details>
<summary>Why a token, rather than reusing the session you're already logged into?</summary>

Because the web client's credentials aren't reachable from an injected script. Cookies don't
authenticate JMAP — `api.fastmail.com` answers `401`. The client does hold an access token in
`window.FastMail.auth`, but sending it as a bearer token is also rejected, and the adjacent
`signingId` / `signingKey` fields suggest requests are signed rather than merely bearing a token.

Patching `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon` in page context
captures **no** API traffic at all while the client is actively loading mail — so Fastmail runs its
JMAP layer in a worker context that page scripts can't observe or borrow from. An API token is the
supported way in, and it has the happier property of not breaking when Fastmail ships a new build.

</details>

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
git -C "$SCRIPTS" rm fm3-daterange.js fm3-daterange.css   # or fm3-contactgroup.*
```

Restart FMail3 and the extension is gone.

## License

[0BSD](LICENSE)
