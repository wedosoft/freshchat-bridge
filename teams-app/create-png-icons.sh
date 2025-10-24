#!/bin/bash

# Create simple colored PNG files using ImageMagick or skip if not available
if command -v convert &> /dev/null; then
    # Color icon: 192x192
    convert -size 192x192 xc:"#0078D4" \
        -fill white -draw "polygon 96,48 144,96 96,144 48,96" \
        -fill "#0078D4" -draw "circle 96,96 96,120" \
        color.png
    
    # Outline icon: 32x32
    convert -size 32x32 xc:transparent \
        -fill none -stroke white -strokewidth 2 -draw "polygon 16,8 24,16 16,24 8,16" \
        -fill white -draw "circle 16,16 16,20" \
        outline.png
    
    echo "PNG icons created with ImageMagick"
else
    echo "ImageMagick not found. Creating placeholder files..."
    # Create placeholder files (will need manual replacement)
    echo "Please replace with actual PNG files" > color.png
    echo "Please replace with actual PNG files" > outline.png
fi
