#!/bin/bash
# Claude Code statusLine command: the session JSON arrives on stdin, one line
# goes out. model · context% · ses N% <time left> · wk N% <reset, local> ·
# branch (+adds,-dels); context reads 0% until the payload has it, and any
# other segment whose data is missing is left out.
input=$(cat)
# Rate limits are account-wide but arrive only after a session's first
# response, so the last ones any session saw stand in until then.
cache=${XDG_CACHE_HOME:-$HOME/.cache}/claude/statusline-rate-limits.json
if jq -e '.rate_limits' >/dev/null <<<"$input"; then
  mkdir -p "${cache%/*}" && jq '.rate_limits' <<<"$input" >"$cache.$$" && mv "$cache.$$" "$cache"
elif [[ -r $cache ]]; then
  input=$(jq --slurpfile rl "$cache" '.rate_limits = $rl[0]' <<<"$input")
fi
dir=$(jq -r '.workspace.current_dir // .cwd // "."' <<<"$input")
export GIT_OPTIONAL_LOCKS=0
branch=$(git -C "$dir" symbolic-ref --short HEAD 2>/dev/null)
# staged and unstaged together; nothing when clean
changes=$(git -C "$dir" diff HEAD --numstat 2>/dev/null |
  awk '{ a += $1; d += $2 } END { if (a + d) printf "(+%d,-%d)", a, d }')
jq -r --arg branch "$branch" --arg changes "$changes" '
  def c($n): "\u001b[\($n)m\(.)\u001b[0m";
  def pct: (. * 10 | round) as $t | "\($t / 10 | floor).\($t % 10)%";
  def left: [(. / 3600 | floor | select(. > 0) | "\(.)hr"),
             (. % 3600 / 60 | floor | select(. > 0) | "\(.)m")]
    | if length > 0 then join(" ") else "0m" end;
  def limit($label; reset): select(.used_percentage != null and (.resets_at // infinite) > now)
    | "\($label) \(.used_percentage | pct)" + (if .resets_at then " " + (.resets_at | reset) else "" end)
    | c(90);
  [ (.model.display_name // empty | sub(" *\\(.*\\)$"; "") | c(36)),
    (.context_window.used_percentage // 0 | pct | c(34)),
    (.rate_limits.five_hour // empty | limit("ses"; [. - now, 0] | max | left)),
    (.rate_limits.seven_day // empty | limit("wk"; strflocaltime("%a %H:%M"))),
    ($branch | select(. != "") | c(35) + ($changes | select(. != "") | " " + c(90)) // c(35))
  ] | join(" · " | c(90))' <<<"$input"
