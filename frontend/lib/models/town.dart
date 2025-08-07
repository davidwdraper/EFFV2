class Town {
  final String name;
  final String state;
  final double lat;
  final double lng;
  final String label; // "Austin, TX" or "Austin, TX (12.3 mi)"

  Town({
    required this.name,
    required this.state,
    required this.lat,
    required this.lng,
    required this.label,
  });

  factory Town.fromJson(Map<String, dynamic> j) => Town(
        name: j['name'] as String,
        state: j['state'] as String,
        lat: (j['lat'] as num).toDouble(),
        lng: (j['lng'] as num).toDouble(),
        label: j['label'] as String? ?? '${j['name']}, ${j['state']}',
      );

  @override
  String toString() => label;
}
