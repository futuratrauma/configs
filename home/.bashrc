# Enable the subsequent settings only in interactive sessions
case $- in
  *i*) ;;
    *) return;;
esac

# ── Oh My Bash (plugins & aliases only — prompt handled by Oh My Posh) ───────
export OSH='/home/ivan/.oh-my-bash'

OMB_USE_SUDO=true
HIST_STAMPS='[yyyy-mm-dd]'

completions=(
  git
  ssh
)

aliases=(
  general
  ls
  arch
)

plugins=(
  git
  bashmarks
  colored-man-pages
  progress
)

# Disable Oh My Bash theme; Oh My Posh replaces it
unset OSH_THEME
source "$OSH/oh-my-bash.sh"

# ── Oh My Posh (cat theme, matches kitty palette) ─────────────────────────────
export PATH="$HOME/.local/bin:$PATH"
if command -v oh-my-posh &>/dev/null; then
  eval "$(oh-my-posh init bash --config "$HOME/.config/oh-my-posh/tonybaloney.omp.json")"
fi

# ── History & shell behavior ──────────────────────────────────────────────────
HISTSIZE=50000
HISTFILESIZE=50000
HISTCONTROL=ignoreboth:erasedups
shopt -s histappend checkwinsize autocd globstar

# ── Editor & pager ────────────────────────────────────────────────────────────
if command -v nvim &>/dev/null; then
  export EDITOR='nvim'
elif command -v vim &>/dev/null; then
  export EDITOR='vim'
fi
export VISUAL="$EDITOR"
export LESS='-R -F -X'

# ── Personal overrides ────────────────────────────────────────────────────────
# alias myproject='cd ~/Projects/myproject'


export PATH=$PATH:/home/ivan/.spicetify

