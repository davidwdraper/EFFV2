import 'package:flutter/material.dart';
import '../models/image_dto.dart';

/// A single row item with:
/// - Left checkbox (select/deselect) — disabled if [onChanged] is null
/// - Image with rounded corners
/// - Caption: "Added on: YYYY-MM-DD by Name"
/// - Optional comment below
class ActImageItem extends StatelessWidget {
  final ImageDto img;
  final bool selected;

  /// Nullable: pass null to make this item read-only (no taps/changes).
  final ValueChanged<bool?>? onChanged;

  final double borderRadius;

  const ActImageItem({
    super.key,
    required this.img,
    required this.selected,
    this.onChanged, // now nullable
    this.borderRadius = 12,
  });

  String _caption() {
    String? dateStr;

    if (img.createdAt is DateTime) {
      final dt = img.createdAt as DateTime;
      final y = dt.year.toString().padLeft(4, '0');
      final m = dt.month.toString().padLeft(2, '0');
      final d = dt.day.toString().padLeft(2, '0');
      dateStr = '$y-$m-$d';
    } else if (img.createdAt is String) {
      final str = img.createdAt as String;
      if (str.trim().isNotEmpty) {
        final parsed = DateTime.tryParse(str);
        if (parsed != null) {
          final y = parsed.year.toString().padLeft(4, '0');
          final m = parsed.month.toString().padLeft(2, '0');
          final d = parsed.day.toString().padLeft(2, '0');
          dateStr = '$y-$m-$d';
        } else {
          dateStr = str; // fallback to raw string if it doesn't parse
        }
      }
    }

    final who = (img.createdByName ?? 'Unknown').trim();
    if (dateStr != null && dateStr.isNotEmpty) {
      return 'Added on: $dateStr by $who';
    }
    return 'Added by $who';
  }

  @override
  Widget build(BuildContext context) {
    final readOnly = onChanged == null;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Checkbox(
          value: selected,
          onChanged: onChanged, // null disables the checkbox
        ),
        Expanded(
          child: InkWell(
            onTap: readOnly ? null : () => onChanged?.call(!selected),
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
