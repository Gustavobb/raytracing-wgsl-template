fn hit_sphere(center: vec3f, radius: f32, r: ray, record: ptr<function, hit_record>, max: f32)
{
  let oc = r.origin - center;
  let half_b = dot(oc, r.direction);
  let c = dot(oc, oc) - radius * radius;
  let discriminant = half_b * half_b - c;

  if (discriminant < 0.0)
  {
    record.hit_anything = false;
    return;
  }

  let sqrt_discriminant = sqrt(discriminant);
  var root = -half_b - sqrt_discriminant;

  // Rays that start inside a sphere must use the exit intersection.
  if (root < RAY_TMIN)
  {
    root = -half_b + sqrt_discriminant;
  }

  if (root < RAY_TMIN || root > max)
  {
    record.hit_anything = false;
    return;
  }

  record.t = root;
  record.p = ray_at(r, root);

  let outward_normal = (record.p - center) / radius;
  record.frontface = dot(r.direction, outward_normal) < 0.0;
  record.normal = select(-outward_normal, outward_normal, record.frontface);
  record.hit_anything = true;
}

fn hit_quad(r: ray, Q: vec4f, u: vec4f, v: vec4f, record: ptr<function, hit_record>, max: f32)
{
  var n = cross(u.xyz, v.xyz);
  var normal = normalize(n);
  var D = dot(normal, Q.xyz);
  var w = n / dot(n.xyz, n.xyz);

  var denom = dot(normal, r.direction);
  if (abs(denom) < 0.0001)
  {
    record.hit_anything = false;
    return;
  }

  var t = (D - dot(normal, r.origin)) / denom;
  if (t < RAY_TMIN || t > max)
  {
    record.hit_anything = false;
    return;
  }

  var intersection = ray_at(r, t);
  var planar_hitpt_vector = intersection - Q.xyz;
  var alpha = dot(w, cross(planar_hitpt_vector, v.xyz));
  var beta = dot(w, cross(u.xyz, planar_hitpt_vector));

  if (alpha < 0.0 || alpha > 1.0 || beta < 0.0 || beta > 1.0)
  {
    record.hit_anything = false;
    return;
  }

  record.t = t;
  record.p = intersection;
  record.normal = normal;
  record.hit_anything = true;
}

fn hit_triangle(r: ray, v0: vec3f, v1: vec3f, v2: vec3f, record: ptr<function, hit_record>, max: f32)
{
  var v1v0 = v1 - v0;
  var v2v0 = v2 - v0;
  var rov0 = r.origin - v0;

  var n = cross(v1v0, v2v0);
  var q = cross(rov0, r.direction);

  let denominator = dot(r.direction, n);
  if (abs(denominator) < 0.000001)
  {
    record.hit_anything = false;
    return;
  }

  var d = 1.0 / denominator;

  var u = d * dot(-q, v2v0);
  var v = d * dot(q, v1v0);
  var t = d * dot(-n, rov0);

  if (u < 0.0 || u > 1.0 || v < 0.0 || (u + v) > 1.0)
  {
    record.hit_anything = false;
    return;
  }

  if (t < RAY_TMIN || t > max)
  {
    record.hit_anything = false;
    return;
  }

  record.t = t;
  record.p = ray_at(r, t);
  record.normal = normalize(n);
  record.hit_anything = true;
}

fn hit_box(r: ray, center: vec3f, rad: vec3f, record: ptr<function, hit_record>, t_max: f32)
{
  let direction_sign = select(vec3f(-1.0), vec3f(1.0), r.direction >= vec3f(0.0));
  let safe_direction = direction_sign * max(abs(r.direction), vec3f(0.00000001));
  var m = 1.0 / safe_direction;
  var n = m * (r.origin - center);
  var k = abs(m) * rad;

  var t1 = -n - k;
  var t2 = -n + k;

  var tN = max(max(t1.x, t1.y), t1.z);
  var tF = min(min(t2.x, t2.y), t2.z);

  if (tN > tF || tF < 0.0)
  {
    record.hit_anything = false;
    return;
  }

  var t = tN;
  var normal = -sign(r.direction) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);

  // When the ray starts inside the box, use the closest exit face.
  if (t < RAY_TMIN)
  {
    t = tF;
    normal = sign(r.direction) * step(t2, vec3f(tF));
  }

  if (t < RAY_TMIN || t > t_max)
  {
    record.hit_anything = false;
    return;
  }

  record.t = t;
  record.p = ray_at(r, t);
  record.normal = normalize(normal);
  record.hit_anything = true;

  return;
}

fn hit_mesh(r: ray, object: mesh, triangle_count: i32, record: ptr<function, hit_record>, t_max: f32)
{
  record.hit_anything = false;

  // Mesh triangles and bounds are stored in model space. Transforming the ray
  // keeps the triangle data compact and preserves its world-space ray t.
  let rotation = quaternion_from_euler(object.rotation.xyz);
  let inverse_rotation = q_inverse(rotation);
  let safe_scale = select(vec3f(1.0), object.scale.xyz, abs(object.scale.xyz) > vec3f(0.000001));
  let local_ray = ray(
    rotate_vector(r.origin - object.transform.xyz, inverse_rotation) / safe_scale,
    rotate_vector(r.direction, inverse_rotation) / safe_scale
  );

  if (!AABB_intersect(local_ray, object.min.xyz, object.max.xyz))
  {
    return;
  }

  let first_triangle = max(0, i32(object.start));
  let last_triangle = min(i32(object.end), triangle_count);
  var closest_t = t_max;
  var triangle_record = hit_record(RAY_TMAX, vec3f(0.0), vec3f(0.0), vec4f(0.0), vec4f(0.0), false, false);

  for (var i = first_triangle; i < last_triangle; i = i + 1)
  {
    let triangle_object = trianglesb[i];
    triangle_record = hit_record(RAY_TMAX, vec3f(0.0), vec3f(0.0), vec4f(0.0), vec4f(0.0), false, false);
    hit_triangle(local_ray, triangle_object.v0.xyz, triangle_object.v1.xyz, triangle_object.v2.xyz, &triangle_record, closest_t);

    if (triangle_record.hit_anything && triangle_record.t < closest_t)
    {
      closest_t = triangle_record.t;
      let world_normal = normalize(rotate_vector(triangle_record.normal / safe_scale, rotation));
      let frontface = dot(r.direction, world_normal) < 0.0;
      record.t = triangle_record.t;
      record.p = ray_at(r, triangle_record.t);
      record.frontface = frontface;
      record.normal = select(-world_normal, world_normal, frontface);
      record.object_color = object.color;
      record.object_material = object.material;
      record.hit_anything = true;
    }
  }
}
