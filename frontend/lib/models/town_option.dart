// lib/models/town_option.dart
class TownOption {
  final String label; // "City, ST"
  final double lat;
  final double lng;
  final String townId;

  TownOption({
    required this.label,
    required this.lat,
    required this.lng,
    required this.townId,
  });

  factory TownOption.fromJson(Map<String, dynamic> j) {
    return TownOption(
      label: (j['label'] as String?) ??
          '${j['name'] as String}, ${j['state'] as String}',
      lat: (j['lat'] as num).toDouble(),
      lng: (j['lng'] as num).toDouble(),
      townId: j['townId']?.toString() ?? j['_id']?.toString() ?? '',
    );
  }

  @override
  String toString() => label;
}
