import os
from PIL import Image, ImageDraw

def create_icon(size):
    # Create an image with transparent background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw a rounded rectangle with gradient-like solid fill
    # Using Indigo (#6366f1) as base
    margin = max(1, size // 10)
    rect_coords = [margin, margin, size - margin, size - margin]
    radius = max(2, size // 5)
    
    # Background color: Indigo/Violet gradient representation
    # Draw rounded rectangle
    draw.rounded_rectangle(rect_coords, radius=radius, fill=(99, 102, 241, 255))
    
    # Draw secondary glowing ring
    ring_margin = margin + max(1, size // 16)
    ring_coords = [ring_margin, ring_margin, size - ring_margin, size - ring_margin]
    ring_radius = max(1, radius - max(1, size // 16))
    draw.rounded_rectangle(ring_coords, radius=ring_radius, outline=(168, 85, 247, 255), width=max(1, size // 24))

    # Draw a clean white symbol representing layers/leetcode/companion
    # Stack of two perspective squares (like the SVG logo)
    cx, cy = size // 2, size // 2
    w = size // 4
    
    # Draw center visual (stylized stack)
    # Top square diamond
    coords = [
        (cx, cy - w),
        (cx + w, cy - w // 2),
        (cx, cy),
        (cx - w, cy - w // 2)
    ]
    draw.polygon(coords, fill=(255, 255, 255, 255))
    
    # Bottom bracket (lower stack layer)
    coords_lower = [
        (cx - w, cy),
        (cx, cy + w // 2),
        (cx + w, cy),
        (cx, cy + w)
    ]
    # Draw two lines representing stack layers
    draw.line([(cx - w, cy + w // 4), (cx, cy + 3 * w // 4), (cx + w, cy + w // 4)], fill=(255, 255, 255, 255), width=max(1, size // 16))
    
    return img

def main():
    output_dir = 'public/icons'
    os.makedirs(output_dir, exist_ok=True)
    
    sizes = [16, 48, 128]
    for size in sizes:
        img = create_icon(size)
        img.save(os.path.join(output_dir, f'icon{size}.png'), 'PNG')
        print(f"Generated {size}x{size} icon.")

if __name__ == '__main__':
    main()
