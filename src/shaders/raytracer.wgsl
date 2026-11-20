const THREAD_COUNT = 16;
const RAY_TMIN = 0.0001;
const RAY_TMAX = 100.0;
const PI = 3.1415927f;
const FRAC_1_PI = 0.31830987f;
const FRAC_2_PI = 1.5707964f;

@group(0) @binding(0)  
  var<storage, read_write> fb : array<vec4f>;

@group(0) @binding(1)
  var<storage, read_write> rtfb : array<vec4f>;

@group(1) @binding(0)
  var<storage, read_write> uniforms : array<f32>;

@group(2) @binding(0)
  var<storage, read_write> spheresb : array<sphere>;

@group(2) @binding(1)
  var<storage, read_write> quadsb : array<quad>;

@group(2) @binding(2)
  var<storage, read_write> boxesb : array<box>;

@group(2) @binding(3)
  var<storage, read_write> trianglesb : array<triangle>;

@group(2) @binding(4)
  var<storage, read_write> meshb : array<mesh>;

struct ray {
  origin : vec3f,
  direction : vec3f,
};

struct sphere {
  transform : vec4f,
  color : vec4f,
  material : vec4f,
};

struct quad {
  Q : vec4f,
  u : vec4f,
  v : vec4f,
  color : vec4f,
  material : vec4f,
};

struct box {
  center : vec4f,
  radius : vec4f,
  rotation: vec4f,
  color : vec4f,
  material : vec4f,
};

struct triangle {
  v0 : vec4f,
  v1 : vec4f,
  v2 : vec4f,
};

struct mesh {
  transform : vec4f,
  scale : vec4f,
  rotation : vec4f,
  color : vec4f,
  material : vec4f,
  min : vec4f,
  max : vec4f,
  show_bb : f32,
  start : f32,
  end : f32,
};

struct material_behaviour {
  scatter : bool,
  direction : vec3f,
};

struct camera {
  origin : vec3f,
  lower_left_corner : vec3f,
  horizontal : vec3f,
  vertical : vec3f,
  u : vec3f,
  v : vec3f,
  w : vec3f,
  lens_radius : f32,
};

struct hit_record {
  t : f32,
  p : vec3f,
  normal : vec3f,
  object_color : vec4f,
  object_material : vec4f,
  frontface : bool,
  hit_anything : bool,
};

fn ray_at(r: ray, t: f32) -> vec3f
{
  return r.origin + t * r.direction;
}

fn get_ray(cam: camera, uv: vec2f, rng_state: ptr<function, u32>) -> ray
{
  var rd = cam.lens_radius * rng_next_vec3_in_unit_disk(rng_state);
  var offset = cam.u * rd.x + cam.v * rd.y;
  return ray(cam.origin + offset, normalize(cam.lower_left_corner + uv.x * cam.horizontal + uv.y * cam.vertical - cam.origin - offset));
}

fn get_camera(lookfrom: vec3f, lookat: vec3f, vup: vec3f, vfov: f32, aspect_ratio: f32, aperture: f32, focus_dist: f32) -> camera
{
  var camera = camera();
  camera.lens_radius = aperture / 2.0;

  var theta = degrees_to_radians(vfov);
  var h = tan(theta / 2.0);
  var w = aspect_ratio * h;

  camera.origin = lookfrom;
  camera.w = normalize(lookfrom - lookat);
  camera.u = normalize(cross(vup, camera.w));
  camera.v = cross(camera.u, camera.w);

  camera.lower_left_corner = camera.origin - w * focus_dist * camera.u - h * focus_dist * camera.v - focus_dist * camera.w;
  camera.horizontal = 2.0 * w * focus_dist * camera.u;
  camera.vertical = 2.0 * h * focus_dist * camera.v;

  return camera;
}

fn envoriment_color(direction: vec3f, color1: vec3f, color2: vec3f) -> vec3f
{
  var unit_direction = normalize(direction);
  var t = 0.5 * (unit_direction.y + 1.0);
  var col = (1.0 - t) * color1 + t * color2;

  var sun_direction = normalize(vec3(uniforms[13], uniforms[14], uniforms[15]));
  var sun_color = int_to_rgb(i32(uniforms[17]));
  var sun_intensity = uniforms[16];
  var sun_size = uniforms[18];

  var sun = clamp(dot(sun_direction, unit_direction), 0.0, 1.0);
  col += sun_color * max(0, (pow(sun, sun_size) * sun_intensity));

  return col;
}

fn check_ray_collision(r: ray, max: f32) -> hit_record
{
  var spheresCount = i32(uniforms[19]);
  var quadsCount = i32(uniforms[20]);
  var boxesCount = i32(uniforms[21]);
  var trianglesCount = i32(uniforms[22]);
  var meshCount = i32(uniforms[27]);

  var record = hit_record(RAY_TMAX, vec3f(0.0), vec3f(0.0), vec4f(0.0), vec4f(0.0), false, false);
  var closest = record;

  for (var i = 0; i < spheresCount; i = i + 1)
  {
    record = hit_record(RAY_TMAX, vec3f(0.0), vec3f(0.0), vec4f(0.0), vec4f(0.0), false, false);
    let sphere_object = spheresb[i];
    hit_sphere(sphere_object.transform.xyz, sphere_object.transform.w, r, &record, min(max, closest.t));

    if (record.hit_anything && record.t < closest.t)
    {
      record.object_color = sphere_object.color;
      record.object_material = sphere_object.material;
      closest = record;
    }
  }

  for (var i = 0; i < quadsCount; i = i + 1)
  {
    record = hit_record(RAY_TMAX, vec3f(0.0), vec3f(0.0), vec4f(0.0), vec4f(0.0), false, false);
    let quad_object = quadsb[i];
    hit_quad(r, quad_object.Q, quad_object.u, quad_object.v, &record, min(max, closest.t));

    if (record.hit_anything && record.t < closest.t)
    {
      record.frontface = dot(r.direction, record.normal) < 0.0;
      record.normal = select(-record.normal, record.normal, record.frontface);
      record.object_color = quad_object.color;
      record.object_material = quad_object.material;
      closest = record;
    }
  }

  for (var i = 0; i < boxesCount; i = i + 1)
  {
    record = hit_record(RAY_TMAX, vec3f(0.0), vec3f(0.0), vec4f(0.0), vec4f(0.0), false, false);
    let box_object = boxesb[i];
    let box_rotation = quaternion_from_euler(box_object.rotation.xyz);
    let inverse_box_rotation = q_inverse(box_rotation);
    let local_ray = ray(
      rotate_vector(r.origin - box_object.center.xyz, inverse_box_rotation) + box_object.center.xyz,
      rotate_vector(r.direction, inverse_box_rotation)
    );
    hit_box(local_ray, box_object.center.xyz, box_object.radius.xyz, &record, min(max, closest.t));

    if (record.hit_anything && record.t < closest.t)
    {
      let outward_normal = normalize(rotate_vector(record.normal, box_rotation));
      record.p = ray_at(r, record.t);
      record.frontface = dot(r.direction, outward_normal) < 0.0;
      record.normal = select(-outward_normal, outward_normal, record.frontface);
      record.object_color = box_object.color;
      record.object_material = box_object.material;
      closest = record;
    }
  }

  for (var i = 0; i < meshCount; i = i + 1)
  {
    record = hit_record(RAY_TMAX, vec3f(0.0), vec3f(0.0), vec4f(0.0), vec4f(0.0), false, false);
    let mesh_object = meshb[i];
    hit_mesh(r, mesh_object, trianglesCount, &record, min(max, closest.t));

    if (record.hit_anything && record.t < closest.t)
    {
      closest = record;
    }
  }

  return closest;
}

fn lambertian(normal : vec3f, absorption: f32, random_sphere: vec3f, rng_state: ptr<function, u32>) -> material_behaviour
{
  var scatter_direction = normal + random_sphere;

  if (dot(scatter_direction, scatter_direction) < 0.000001)
  {
    scatter_direction = normal;
  }

  let scatter = absorption < rng_next_float(rng_state);
  return material_behaviour(scatter, normalize(scatter_direction));
}

fn metal(normal : vec3f, direction: vec3f, fuzz: f32, random_sphere: vec3f) -> material_behaviour
{
  let scattered = reflect(direction, normal) + fuzz * random_sphere;
  return material_behaviour(dot(scattered, normal) > 0.0, normalize(scattered));
}

fn dielectric(normal : vec3f, r_direction: vec3f, refraction_index: f32, frontface: bool, random_sphere: vec3f, fuzz: f32, rng_state: ptr<function, u32>) -> material_behaviour
{
  let unit_direction = normalize(r_direction);

  let refraction_ratio = select(refraction_index, 1.0 / refraction_index, frontface);
  let cos_theta = min(dot(-unit_direction, normal), 1.0);
  let sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));

  let r0_base = (1.0 - refraction_ratio) / (1.0 + refraction_ratio);
  let r0 = r0_base * r0_base;
  let reflectance = r0 + (1.0 - r0) * pow(1.0 - cos_theta, 5.0);
  let cannot_refract = refraction_ratio * sin_theta > 1.0;

  var direction = refract(unit_direction, normal, refraction_ratio) + random_sphere * fuzz;
  if (cannot_refract || reflectance > rng_next_float(rng_state))
  {
    direction = reflect(unit_direction, normal);
  }

  return material_behaviour(true, direction);
}

fn emmisive(color: vec3f, light: f32) -> material_behaviour
{
  return material_behaviour(light < 0.01, color * light);
}

fn trace(r: ray, rng_state: ptr<function, u32>) -> vec3f
{
  var maxbounces = i32(uniforms[2]);
  var light = vec3f(0.0);
  var color = vec3f(1.0);
  var r_ = r;
  
  var backgroundcolor1 = int_to_rgb(i32(uniforms[11]));
  var backgroundcolor2 = int_to_rgb(i32(uniforms[12]));
  var behaviour = material_behaviour(true, vec3f(0.0));

  for (var j = 0; j < maxbounces; j = j + 1)
  {
    if (!behaviour.scatter)
    {
      break;
    }

    let record = check_ray_collision(r_, RAY_TMAX);

    if (!record.hit_anything)
    {
      light += color * envoriment_color(r_.direction, backgroundcolor1, backgroundcolor2);
      break;
    }

    let random_sphere = rng_next_vec3_in_unit_sphere(rng_state);
    let smoothness = record.object_material.x;
    let absorption = record.object_material.y;
    let specularity = record.object_material.z;
    let diffuse = lambertian(record.normal, absorption, random_sphere, rng_state);
    let metallic = metal(record.normal, r_.direction, absorption, random_sphere);
    let emission = emmisive(record.object_color.xyz, record.object_material.w);

    let specular_bounce = specularity > rng_next_float(rng_state);
    behaviour.direction = mix(diffuse.direction, metallic.direction, smoothness * f32(specular_bounce));
    behaviour.scatter = bool(mix(f32(diffuse.scatter), f32(metallic.scatter), smoothness)) && emission.scatter;

    if (smoothness < 0.0)
    {
      behaviour = dielectric(record.normal, r_.direction, specularity, record.frontface, random_sphere, absorption, rng_state);
    }

    if (length(behaviour.direction) < RAY_TMIN)
    {
      behaviour.direction = record.normal;
    }

    light += emission.direction * color;
    color *= record.object_color.xyz;
    r_ = ray(record.p, behaviour.direction);
  }

  return light;
}

@compute @workgroup_size(THREAD_COUNT, THREAD_COUNT, 1)
fn render(@builtin(global_invocation_id) id : vec3u)
{
    var rez = uniforms[1];
    var time = u32(uniforms[0]);

    if (id.x >= u32(rez) || id.y >= u32(rez))
    {
      return;
    }

    var rng_state = init_rng(vec2(id.x, id.y), vec2(u32(rez)), time);

    // Camera
    var lookfrom = vec3(uniforms[7], uniforms[8], uniforms[9]);
    var lookat = vec3(uniforms[23], uniforms[24], uniforms[25]);

    // Get camera
    var cam = get_camera(lookfrom, lookat, vec3(0.0, 1.0, 0.0), uniforms[10], 1.0, uniforms[6], uniforms[5]);
    var samples_per_pixel = max(1, i32(uniforms[4]));
    var color = vec3f(0.0);
    let frag_coord = vec2f(f32(id.x), f32(id.y));
    let uv = (frag_coord + sample_square(&rng_state)) / vec2f(rez);

    for (var sample = 0; sample < samples_per_pixel; sample = sample + 1)
    {
      let camera_ray = get_ray(cam, uv, &rng_state);
      color += trace(camera_ray, &rng_state);
    }

    color /= f32(samples_per_pixel);
    color = max(color, vec3f(0.0));

    var color_out = vec4(linear_to_gamma(color), 1.0);
    var map_fb = mapfb(id.xy, rez);
    
    var should_accumulate = uniforms[3];

    if (should_accumulate > 0.5 && time > 1u)
    {
      let previous = rtfb[map_fb];
      let frame = f32(time);
      color_out = (previous * (frame - 1.0) + color_out) / frame;
    }

    rtfb[map_fb] = color_out;
    fb[map_fb] = color_out;
}
