#!/usr/bin/env bash
# Update an existing local project without replacing its installed dependencies or H2 library.
set -euo pipefail

source_dir="$(cd "$(dirname "$0")" && pwd -P)"
target_dir="${1:-$HOME/Downloads/music-description-studio-8}"

if [ ! -f "$target_dir/server/src/main/java/dev/nathaniel/music/TrackService.java" ] || \
   [ ! -f "$target_dir/frontend/src/main.jsx" ] || \
   [ ! -f "$target_dir/start-mac.sh" ]; then
    printf 'Could not find the existing Music Description Studio project at %s.\n' "$target_dir" >&2
    printf 'Run: bash update-current-mac.sh /path/to/your/existing-project\n' >&2
    exit 1
fi

for name in main.jsx WaveformPlayer.jsx style.css; do
    cp "$source_dir/frontend/src/$name" "$target_dir/frontend/src/$name"
done
cp "$source_dir/server/src/main/java/dev/nathaniel/music/MusicDescriptionApplication.java" \
   "$target_dir/server/src/main/java/dev/nathaniel/music/MusicDescriptionApplication.java"
cp "$source_dir/server/src/main/resources/application.properties" \
   "$target_dir/server/src/main/resources/application.properties"
cp "$source_dir/start-mac.sh" "$target_dir/start-mac.sh"
cp "$source_dir/README.md" "$target_dir/README.md"

for old_source in \
    "$target_dir/frontend/src/SpotifyPanel.jsx" \
    "$target_dir/server/src/main/java/dev/nathaniel/music/SpotifyController.java" \
    "$target_dir/server/src/main/java/dev/nathaniel/music/SpotifyService.java" \
    "$target_dir/server/.env.example" \
    "$target_dir/frontend/src/SoundCloudPanel.jsx" \
    "$target_dir/server/src/main/java/dev/nathaniel/music/SoundCloudController.java" \
    "$target_dir/server/src/main/java/dev/nathaniel/music/SoundCloudService.java"; do
    rm -f "$old_source"
done

# Maven may keep compiled classes for Java files removed from a newer package.
# Rebuild them from the remaining sources; the H2 file lives outside target/.
rm -rf "$target_dir/server/target"

printf 'Removed streaming integrations from %s. Your Python/npm dependencies and saved H2 library are unchanged.\n' "$target_dir"
printf 'Your old server/.env, if present, is no longer loaded.\n'
bash "$target_dir/start-mac.sh"
