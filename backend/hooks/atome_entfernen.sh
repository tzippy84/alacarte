#!/bin/bash
# Entfernt Apple-Katalog-Kennungen aus m4a/m4p-Dateien.
# Aufruf:  ./atome_entfernen.sh /Pfad/zur/Datei.m4a   (nur diese eine Datei)
#          ./atome_entfernen.sh /Pfad/zum/Ordner      (alle m4a/m4p darin)
# Ohne Argument wird der aktuelle Ordner verwendet.
# Beschreibende Tags, Cover und iTunSMPB (Gapless) bleiben unangetastet.
# Exit-Code 1, wenn bei einer Einzeldatei ein Fehler auftritt.

ZIEL="${1:-.}"

ATOME=(
  "moov.udta.meta.ilst.cnID"   # Katalog-ID der Aufnahme
  "moov.udta.meta.ilst.atID"   # Interpreten-ID
  "moov.udta.meta.ilst.plID"   # Album-/Playlist-ID
  "moov.udta.meta.ilst.geID"   # Genre-ID
  "moov.udta.meta.ilst.sfID"   # Storefront (Land)
  "moov.udta.meta.ilst.akID"   # Account-Typ
  "moov.udta.meta.ilst.cmID"   # Komponisten-ID
  "moov.udta.meta.ilst.apID"   # Apple-ID des Kaeufers
  "moov.udta.meta.ilst.ownr"   # Name des Kaeufers
  "moov.udta.meta.ilst.purd"   # Kaufdatum
  "moov.udta.meta.ilst.xid "   # Vendor-Kennung
  "moov.udta.meta.ilst.----.name:[ISRC]"
  "moov.udta.meta.ilst.----.name:[UPC]"
  "moov.udta.meta.ilst.----.name:[iTunMOVI]"
  "moov.udta.meta.ilst.----.name:[iTunEXTC]"
  "moov.udta.meta.ilst.----.name:[Encoding Params]"
)

ARGS=()
for a in "${ATOME[@]}"; do ARGS+=(--manualAtomRemove "$a"); done

bearbeite() {
  if AtomicParsley "$1" "${ARGS[@]}" --overWrite >/dev/null 2>&1; then
    printf '  %s\n' "${1##*/}"
    return 0
  fi
  printf '  FEHLER: %s\n' "$1" >&2
  return 1
}

# Einzeldatei: nur diese bearbeiten
if [ -f "$ZIEL" ]; then
  bearbeite "$ZIEL"
  exit $?
fi

n=0
while IFS= read -r -d '' f; do
  if bearbeite "$f"; then n=$((n+1)); fi
done < <(find "$ZIEL" -type f \( -iname "*.m4a" -o -iname "*.m4p" \) -print0)
echo "$n Dateien bearbeitet."
