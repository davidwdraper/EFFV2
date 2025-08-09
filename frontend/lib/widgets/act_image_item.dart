import 'package:flutter/material.dart';
import '../models/image_dto.dart';

/// A single row item with:
/// - Left checkbox (select/deselect)
/// - Image with rounded corners
/// - Caption: "Added on: YYYY-MM-DD by Name"
/// - Optional comment below
class ActImageItem extends StatelessWidget {
  final ImageDto img;
  final bool selected;
  final ValueChanged<bool?> onChanged;
  final double borderRadius;

  const ActImageItem({
    super.key,
    required this.img,
    required this.selected,
    required this.onChanged,
    this.borderRadius = 12,
  });

  String _caption() {
    final date = img.createdAt;
    final y = date.year.toString().padLeft(4, '0');
    final m = date.month.toString().padLeft(2, '0');
    final d = date.day.toString().padLeft(2, '0');
    final who = img.createdByName ?? 'Unknown';
    return 'Added on: $y-$m-$d by $who';
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Checkbox(
          value: selected,
          onChanged: onChanged,
        ),
        Expanded(
          child: InkWell(
            onTap: () => onChanged(!selected),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(borderRadius),
                  child: AspectRatio(
                    aspectRatio: 4 / 3,
                    child: Image.network(
                      img.url,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(
                        color: Colors.grey[200],
                        alignment: Alignment.center,
                        child: const Icon(Icons.broken_image_outlined),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  _caption(),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                if ((img.comment ?? '').isNotEmpty)
                  Text(
                    img.comment!,
                    style: Theme.of(context)
                        .textTheme
                        .bodySmall
                        ?.copyWith(color: Colors.black54),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
