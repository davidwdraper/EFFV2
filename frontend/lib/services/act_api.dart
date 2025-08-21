// lib/services/act_api.dart

import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;

import '../models/town.dart';
import '../models/act.dart'; // ← needs Act.fromJson(id/email/name/homeTown)

/* Debouncer stays the same */
class Debouncer {
  Debouncer({this.ms = 300});
  final int ms;
  Timer? _t;
  Future<T> run<T>(Future<T> Function() fn) {
    _t?.cancel();
    final c = Completer<T>();
    _t = Timer(Duration(milliseconds: ms), () async {
      try {
        c.complete(await fn());
      } catch (e, st) {
        c.completeError(e, st);
      }
    });
    return c.future;
  }

  void dispose() => _t?.cancel();
}

class ActApi {
  // Point this at your gateway (adjust host/port as needed)
  final String baseUrl;
  final http.Client _client;
  final Debouncer _debounce = Debouncer(ms: 300);

  // Soft client-side cap: one screenful; prevents accidental limit=1000
  static const int _perPageCap = 50;

  ActApi({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        baseUrl = baseUrl ??
            const String.fromEnvironment('EFF_API_BASE',
                defaultValue: 'http://localhost:4000');

  // ───────────────────────────────────────────────────────────────────────────
  // TOWNS (kept as-is, with tiny hardening + cache-busting headers)
  // ───────────────────────────────────────────────────────────────────────────

  Future<List<Town>> getHometowns(String q,
      {String? state, int limit = 10}) async {
    if (q.trim().length < 3) return [];
    final effectiveLimit =
        limit <= 0 ? 10 : (limit > _perPageCap ? _perPageCap : limit);

    final uri = Uri.parse('$baseUrl/acts/hometowns').replace(queryParameters: {
      'q': q.trim(),
      if (state != null && state.isNotEmpty) 'state': state,
      'limit': '$effectiveLimit',
    });

    // Debounce to avoid spamming the API on each keystroke
    return _debounce.run(() async {
      final res = await _client.get(uri, headers: _noStoreHeaders);
      if (res.statusCode != 200) {
        throw Exception('hometowns failed: ${res.statusCode} ${res.body}');
      }
      final list = jsonDecode(res.body) as List;
      return list
          .map((e) => Town.fromJson(e as Map<String, dynamic>))
          .toList(growable: false);
    });
  }

  Future<List<Town>> getHometownsNear({
    required double lat,
    required double lng,
    int? radiusMi,
    int limit = 50,
  }) async {
    final effectiveLimit =
        limit <= 0 ? 10 : (limit > _perPageCap ? _perPageCap : limit);
    final qp = <String, String>{
      'lat': '$lat',
      'lng': '$lng',
      'limit': '$effectiveLimit',
      if (radiusMi != null) 'radiusMi': '$radiusMi',
    };
    final uri =
        Uri.parse('$baseUrl/acts/hometowns/near').replace(queryParameters: qp);

    final res = await _client.get(uri, headers: _noStoreHeaders);
    if (res.statusCode != 200) {
      throw Exception('near failed: ${res.statusCode} ${res.body}');
    }
    final list = jsonDecode(res.body) as List;
    return list
        .map((e) => Town.fromJson(e as Map<String, dynamic>))
        .toList(growable: false);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ACTS (new) — matches the backend we just wired
  // ───────────────────────────────────────────────────────────────────────────

  /// GET /acts/by-hometown?lat=&lng=&miles=&limit=&q=
  /// - If the area is sparse (<= cutoff), backend returns all-in-radius (items directly).
  /// - If dense and q is empty, backend may 400 with { code: "NEEDS_QUERY" }.
  Future<List<Act>> getActsByHometown({
    required double lat,
    required double lng,
    required double miles,
    int limit = 20,
    String? q,
  }) async {
    final effectiveLimit =
        limit <= 0 ? 20 : (limit > _perPageCap ? _perPageCap : limit);

    final uri =
        Uri.parse('$baseUrl/acts/by-hometown').replace(queryParameters: {
      'lat': '$lat',
      'lng': '$lng',
      'miles': '$miles',
      'limit': '$effectiveLimit',
      if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
    });

    final res = await _client.get(uri, headers: _noStoreHeaders);

    if (res.statusCode == 200) {
      return _parseActs(res.body);
    }

    if (res.statusCode == 400) {
      final body = _safeJson(res.body);
      if (body is Map && body['code'] == 'NEEDS_QUERY') {
        // Let caller switch UI into typeahead mode
        throw StateError('NEEDS_QUERY:${body['total'] ?? ''}');
      }
    }

    throw StateError('acts/by-hometown failed: ${res.statusCode} ${res.body}');
  }

  /// GET /acts/search?lat=&lng=&miles=&q=&limit=
  /// Use this when you already have a query (typeahead mode).
  Future<List<Act>> searchActs({
    required double lat,
    required double lng,
    required double miles,
    required String q,
    int limit = 20,
  }) async {
    final effectiveLimit =
        limit <= 0 ? 20 : (limit > _perPageCap ? _perPageCap : limit);

    final uri = Uri.parse('$baseUrl/acts/search').replace(queryParameters: {
      'lat': '$lat',
      'lng': '$lng',
      'miles': '$miles',
      'q': q.trim(),
      'limit': '$effectiveLimit',
    });

    // Debounced to keep keystrokes cheap
    return _debounce.run(() async {
      final res = await _client.get(uri, headers: _noStoreHeaders);
      if (res.statusCode == 200) return _parseActs(res.body);
      throw StateError('acts/search failed: ${res.statusCode} ${res.body}');
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  static const Map<String, String> _noStoreHeaders = {
    'Cache-Control': 'no-cache, no-store, max-age=0',
    'Pragma': 'no-cache',
  };

  dynamic _safeJson(String body) {
    try {
      return jsonDecode(body);
    } catch (_) {
      return null;
    }
  }

  List<Act> _fromList(dynamic list) {
    if (list is! List) return const <Act>[];
    return list
        .whereType<Map<String, dynamic>>()
        .map((e) => Act.fromJson(e))
        .toList(growable: false);
  }

  /// Accepts either `{ items: [...] }` or a raw `[...]` array (future-proof).
  List<Act> _parseActs(String body) {
    final decoded = _safeJson(body);
    if (decoded is List) return _fromList(decoded);
    if (decoded is Map<String, dynamic>) return _fromList(decoded['items']);
    return const <Act>[];
  }

  void dispose() {
    _client.close();
    _debounce.dispose();
  }
}
