"""
Kea Icon Background Removal Script
Removes white backgrounds from Set 1 icons using rembg AI
"""

from rembg import remove
from PIL import Image
import os

def remove_background(input_path, output_path):
    """Remove background from image and save as PNG with transparency"""
    print(f"Processing: {input_path}")
    
    # Open the image
    with open(input_path, 'rb') as input_file:
        input_data = input_file.read()
    
    # Remove background using AI
    output_data = remove(input_data)
    
    # Save as PNG with transparency
    with open(output_path, 'wb') as output_file:
        output_file.write(output_data)
    
    print(f"✅ Saved: {output_path}")

def main():
    # Paths
    input_dir = "public"
    output_dir = "public/transparent"
    
    # Create output directory if it doesn't exist
    os.makedirs(output_dir, exist_ok=True)
    
    # Icons to process
    icons = [
        "set1_silent.png",
        "set1_listening.png",
        "set1_speaking.png"
    ]
    
    print("🦜 Kea Icon Background Removal")
    print("=" * 50)
    print(f"Input:  {input_dir}/")
    print(f"Output: {output_dir}/")
    print("=" * 50)
    
    # Process each icon
    for icon in icons:
        input_path = os.path.join(input_dir, icon)
        output_path = os.path.join(output_dir, icon)
        
        if os.path.exists(input_path):
            remove_background(input_path, output_path)
        else:
            print(f"⚠️  File not found: {input_path}")
    
    print("=" * 50)
    print("✨ Background removal complete!")
    print(f"Transparent icons saved to: {output_dir}/")

if __name__ == "__main__":
    main()
