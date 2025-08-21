// lib/models/act.dart

class Act {
  final String id;
  final String name;
  final String homeTown;
  final String? email;
  final String? homeTownId; // stringified ObjectId
  final List<double>? homeTownLoc; // [lng, lat]
  final List<String> imageIds;

  const Act({
    required this.id,
    required this.name,
    required this.homeTown,
    this.email,
    this.homeTownId,
    this.homeTownLoc,
    this.imageIds = const [],
  });

  factory Act.fromJson(Map<String, dynamic> j) {
    // id may come as `id` or legacy `_id`
    final rawId = (j['id'] ?? j['_id'] ?? '').toString();

    // homeTownLoc may be a GeoJSON object { type, coordinates: [lng,lat] }
    List<double>? loc;
    final locVal = j['homeTownLoc'];
    if (locVal is Map && locVal['coordinates'] is List) {
      final coords = (locVal['coordinates'] as List)
          .where((e) => e is num)
          .map((e) => (e as num).toDouble())
          .toList(growable: false);
      if (coords.length == 2) loc = coords;
    }

    // imageIds may be absent or mixed types; normalize to List<String>
    final List<String> images =
        (j['imageIds'] is List ? (j['imageIds'] as List) : const <dynamic>[])
            .map((e) => e.toString())
            .toList(growable: false);

    return Act(
      id: rawId,
      name: (j['name'] ?? '').toString(),
      homeTown: (j['homeTown'] ?? '').toString(),
      email: (j['email'] as String?)?.toString(),
      homeTownId: (j['homeTownId'] != null) ? j['homeTownId'].toString() : null,
      homeTownLoc: loc,
      imageIds: images,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'homeTown': homeTown,
      if (email != null) 'email': email,
      if (homeTownId != null) 'homeTownId': homeTownId,
      if (homeTownLoc != null)
        'homeTownLoc': {
          'type': 'Point',
          'coordinates': homeTownLoc,
        },
      'imageIds': imageIds,
    };
  }

  Act copyWith({
    String? id,
    String? name,
    String? homeTown,
    String? email,
    String? homeTownId,
    List<double>? homeTownLoc,
    List<String>? imageIds,
  }) {
    return Act(
      id: id ?? this.id,
      name: name ?? this.name,
      homeTown: homeTown ?? this.homeTown,
      email: email ?? this.email,
      homeTownId: homeTownId ?? this.homeTownId,
      homeTownLoc: homeTownLoc ?? this.homeTownLoc,
      imageIds: imageIds ?? this.imageIds,
    );
  }

  @override
  String toString() =>
      'Act(id: $id, name: $name, homeTown: $homeTown, email: $email)';
}
