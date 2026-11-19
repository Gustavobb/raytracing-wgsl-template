import { getGPU, getCanvas, getComputeBuffer, getComputeBufferLayout, getModule, getRenderPipeline, RGBToInt, timer, RGBToHex, crateAllScenesList } from "./src/util.js";
import { Sphere, Quad, Box, Triangle, Mesh } from "./src/objects.js";
import { getAvailableScene } from "./src/scenes.js";

// arrays
let spheres = [];
let quads = [];
let boxes = [];
let triangles = [];
let meshes = [];

// variables and constants
const THREAD_COUNT = 16;
const MAX_SPHERES = 70;
const MAX_QUADS = 10;
const MAX_BOXES = 20;
const MAX_TRIANGLES = 1000;
const MAX_MESHES = 3;

let sphereTemplate = new Sphere([0.0, 0.1, -1.5], [0.4, 0.9, 0.8], 0.5, [0.0, 0.0, 0.0, 0.0]);
let quadTemplate = new Quad([-1.0, -1.0, 0.0, 0.0], [0.0, 0.0, -2.0, 0.0], [0.0, 2.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0]);
let boxTemplate = new Box([0.0, 0.0, -2.0], [1.0, 1.0, 1.0], [0.0, 0.0, 0.0], [0.5, 0.5, 0.5], [0.0, 0.0, 0.0, 0.0]);
let triangleTemplate = new Triangle([0.0, 0.0, -2.0, 0.0], [1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0]);
let meshTemplate = new Mesh([0.0, 0.0, -2.0, 0.0], [1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0], 0, 0, 0);

let perfCount = 0;
let cameraVelocity = [0.0, 0.0, 0.0];
let cameraRotationVelocity = [0.0, 0.0, 0.0];
let performanceStats = { ms: 0, fps: 0 };

const sizes = { f32: 4, u32: 4, i32: 4, vec2: 8, vec4: 16 };
const uniforms = {
    frameCount: 0, // 0
    rez: 768, // 1
    maxBounces: 10, // 2
    shouldAccumulate: 1, // 3
    samplesPerPixel: 1, // 4
    focusDistance: 5.0, // 5
    focusAngle: 0.2, // 6
    camerax: 0, // 7
    cameray: 0, // 8
    cameraz: 0, // 9
    vfov: 90, // 10
    backgroundColor1: 0.0, // 11
    backgroundColor2: 0.0, // 12
    sunx: -0.4, // 13
    suny: 0.7, // 14
    sunz: -0.6, // 15
    sunIntensity: 1.0, // 16
    sunColor: 1.0, // 17
    sunSize: 100.0, // 18
    sphereCount: spheres.length, // 19
    quadCount: quads.length, // 20
    boxCount: boxes.length, // 21
    trianglesCount: triangles.length, // 22
    lookatx: 0, // 23
    lookaty: 0, // 24
    lookatz: -4, // 25
    debugShowLookAt: 0, // 26
    meshCount: meshes.length, // 27
}

const uniformsCount = Object.keys(uniforms).length;

// get the GPU and canvas
const { adapter, gpu } = await getGPU();
const { canvas, context, format } = await getCanvas(uniforms.rez);
context.configure({ device: gpu, format: format, alphaMode: "premultiplied", usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,});

// create the buffers
const frameBufferSize = sizes.vec4 * uniforms.rez ** 2;
const frameBuffer = await getComputeBuffer(gpu, frameBufferSize, GPUBufferUsage.STORAGE);

const rayTraceFrameBufferSize = sizes.vec4 * uniforms.rez ** 2;
const rayTraceFrameBuffer = await getComputeBuffer(gpu, rayTraceFrameBufferSize, GPUBufferUsage.STORAGE);

const uniformsBufferSize = sizes.f32 * uniformsCount;
const uniformsBuffer = await getComputeBuffer(gpu, uniformsBufferSize, GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE);

const spheresBufferSize = (sizes.vec4 * 3) * MAX_SPHERES;
const spheresBuffer = await getComputeBuffer(gpu, spheresBufferSize, GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE);

const quadsBufferSize = (sizes.vec4 * 5) * MAX_QUADS;
const quadsBuffer = await getComputeBuffer(gpu, quadsBufferSize, GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE);

const boxesBufferSize = (sizes.vec4 * 5) * MAX_BOXES;
const boxesBuffer = await getComputeBuffer(gpu, boxesBufferSize, GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE);

const trianglesBufferSize = (sizes.vec4 * 3) * MAX_TRIANGLES;
const trianglesBuffer = await getComputeBuffer(gpu, trianglesBufferSize, GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE);

const meshesBufferSize = (sizes.vec4 * 7 + 3 * sizes.f32) * MAX_MESHES;
const meshesBuffer = await getComputeBuffer(gpu, meshesBufferSize, GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE);

const frameBuffers = [{ buffer: frameBuffer, type: "storage" }, { buffer: rayTraceFrameBuffer, type: "storage" }];
const { bindGroupLayout: frameBuffersLayout, bindGroup: frameBuffersBindGroup } = await getComputeBufferLayout(gpu, frameBuffers);

const uniformBuffers = [{ buffer: uniformsBuffer, type: "storage" }];
const { bindGroupLayout: uniformsLayout, bindGroup: uniformsBindGroup } = await getComputeBufferLayout(gpu, uniformBuffers);

const objectBuffers = [
    { buffer: spheresBuffer, type: "storage" }, 
    { buffer: quadsBuffer, type: "storage" }, 
    { buffer: boxesBuffer, type: "storage" }, 
    { buffer: trianglesBuffer, type: "storage" }, 
    { buffer: meshesBuffer, type: "storage" }
];

// bind group layout
const { bindGroupLayout: objectsLayout, bindGroup: objectsBindGroup } = await getComputeBufferLayout(gpu, objectBuffers);

// memory layout
const layout = gpu.createPipelineLayout({ bindGroupLayouts: [frameBuffersLayout, uniformsLayout, objectsLayout] });

// set the uniforms
const module = await getModule(gpu, ["./src/shaders/utils.wgsl", "./src/shaders/rng.wgsl", "./src/shaders/raytracer.wgsl", "./src/shaders/shapes.wgsl"]);

// get the render kernel
const renderKernel = gpu.createComputePipeline({ layout, compute: { module, entryPoint: "render" }, });

// get the render pipeline
const { renderPipeline: renderPipeline, bindGroupLayout: renderBindGroupLayout } = await getRenderPipeline(gpu, uniforms.rez, frameBuffer, format);
let availableScenes = await crateAllScenesList();

//!!!! LIL GUI IGNORE THIS
let gui = new lil.GUI();
let performanceFolder = gui.addFolder("Performance");
performanceFolder.add(performanceStats, 'fps').name("fps").listen().disable();
performanceFolder.add(performanceStats, 'ms').name("ms").listen().disable();

let scenesFolder = gui.addFolder("Scene");
const scenesNames = { name: "Spheres"};

scenesFolder.add(scenesNames, 'name', availableScenes).name("Scene").listen().onChange( function() { getScene(scenesNames.name); });
var cameraVelocityConstant = 5.0;
scenesFolder.add({ CameraVelocity: cameraVelocityConstant }, 'CameraVelocity').name("Camera Velocity").step(0.01).listen().onChange( function() { cameraVelocityConstant = this.object.CameraVelocity; });

scenesFolder.add({ NewScene: () => {
    spheres = [new Sphere([0, -1001, 0], [0.5, 0.5, 0.5], 1000, [0.9, 0.0, 0.6, 0.0]), new Sphere([0.0, 0.3, -5], [0.8, 0.1, 0.2], 1.3, [0.0, 0.001, 0.0, 0.0])];
    quads = [];
    boxes = [];
    meshes = [];
    triangles = [];
    
    generateBackgroundColor([1.0, 1.0, 1.0], [0.5, 0.7, 1.0]);
    writeBuffers();
    writeUniforms();
    refreshObjectsGUI(0, true);
    handleAccumulate(false);
}}, 'NewScene');

scenesFolder.add({ ResetScene: () => { getScene(scenesNames.name); }}, 'ResetScene');

scenesFolder.add({ ResetCamera: () => {
    uniforms.camerax = 0;
    uniforms.cameray = 0;
    uniforms.cameraz = 0;
    uniforms.lookatx = 0;
    uniforms.lookaty = 0;
    uniforms.lookatz = -4;
    handleAccumulate(false);
}}, 'ResetCamera');

scenesFolder.add({ SaveImage: () => {
    let link = document.createElement('a');
    link.download = 'image.png';
    link.href = canvas.toDataURL();
    link.click();
}}, 'SaveImage');

scenesFolder.add({ PrintScene: () => { printCurrentScene(); }}, 'PrintScene');

let uniformsFolder = gui.addFolder("Uniforms");
uniformsFolder.add(uniforms, 'samplesPerPixel').name("Samples Per Pixel").step(1).listen();
uniformsFolder.add(uniforms, 'maxBounces').name("Max Bounces").step(1).listen();
uniformsFolder.add(uniforms, 'focusDistance').name("Focus Distance").step(0.01).listen();
uniformsFolder.add(uniforms, 'focusAngle').name("Focus Angle").step(0.01).listen();
uniformsFolder.add(uniforms, 'vfov').name("Vertical FOV").step(0.01).listen();
uniformsFolder.add(uniforms, 'debugShowLookAt').name("Debug Show Look At").listen();

let sunFolder = gui.addFolder("Sun");
sunFolder.add(uniforms, 'sunx').name("Sun X").step(0.01).listen();
sunFolder.add(uniforms, 'suny').name("Sun Y").step(0.01).listen();
sunFolder.add(uniforms, 'sunz').name("Sun Z").step(0.01).listen();
sunFolder.add(uniforms, 'sunIntensity').name("Sun Intensity").step(0.01).listen();

const sunColor = {
    sunColor: '#FFFFFF',
    object: { r: 1, g: 1, b: 1 },
};

sunFolder.addColor( sunColor, 'sunColor' ).onChange( function() {
    sunColor.object.r = parseInt(sunColor.sunColor.substring(1, 3), 16) / 255;
    sunColor.object.g = parseInt(sunColor.sunColor.substring(3, 5), 16) / 255;
    sunColor.object.b = parseInt(sunColor.sunColor.substring(5, 7), 16) / 255;
}).listen();

sunFolder.add(uniforms, 'sunSize').name("Sun Size").step(0.01).listen();

let background = gui.addFolder("Background Color");
const backgroundColor1 = { BGC1: '#FFFFFF', object: { r: 1, g: 1, b: 1 },};
const backgroundColor2 = { BGC2: '#7FB2FF', object: { r: 0.5, g: 0.7, b: 1 },};

background.addColor( backgroundColor1, 'BGC1' ).onChange( function() {
    backgroundColor1.object.r = parseInt(backgroundColor1.BGC1.substring(1, 3), 16) / 255;
    backgroundColor1.object.g = parseInt(backgroundColor1.BGC1.substring(3, 5), 16) / 255;
    backgroundColor1.object.b = parseInt(backgroundColor1.BGC1.substring(5, 7), 16) / 255;
}).listen();

background.addColor( backgroundColor2, 'BGC2' ).onChange( function() {
    backgroundColor2.object.r = parseInt(backgroundColor2.BGC2.substring(1, 3), 16) / 255;
    backgroundColor2.object.g = parseInt(backgroundColor2.BGC2.substring(3, 5), 16) / 255;
    backgroundColor2.object.b = parseInt(backgroundColor2.BGC2.substring(5, 7), 16) / 255;
}).listen();


let objectsFolder = gui.addFolder("Objects");

function refreshObjectGUI(template, objectList, parentFolder, folder, startIndex, hasButtons = true)
{
    let objectFolder = folder;
    if (!objectFolder)
    {
        objectFolder = parentFolder.addFolder(template.name + "(s)");
        
        if (hasButtons)
        {
            objectFolder.add({ AddObject: () => {
                let copyTemplate = JSON.parse(JSON.stringify(template));
                objectList.push(copyTemplate);
                refreshObjectGUI(template, objectList, parentFolder, objectFolder, objectList.length - 1);
                handleAccumulate(false);
                writeBuffers();
            }}, 'AddObject');
        }

        objectFolder.close();
    }

    let variables = Object.keys(template);

    for (let i = startIndex; i < objectList.length; i++)
    {
        let folder = objectFolder.addFolder(`${template.name} ${i + 1}`);
        for (let j = 1; j < variables.length; j++)
        {
            let folderVariable = folder.addFolder(variables[j]);
            let lengthOfVariable = 0;
            if (typeof template[variables[j]] === 'object')
            {
                lengthOfVariable = template[variables[j]].length;
            }
            switch (variables[j])
            {
                case "color":
                    let colorObj = {
                        Hex: RGBToHex(objectList[i].color[0] * 255, objectList[i].color[1] * 255, objectList[i].color[2] * 255),
                    };

                    folderVariable.addColor(colorObj, 'Hex').onChange( function() {
                        objectList[i].color[0] = parseInt(colorObj.Hex.substring(1, 3), 16) / 255;
                        objectList[i].color[1] = parseInt(colorObj.Hex.substring(3, 5), 16) / 255;
                        objectList[i].color[2] = parseInt(colorObj.Hex.substring(5, 7), 16) / 255;
                    });

                    folderVariable.close();
                    break;

                case "material":
                    for (let k = 0; k < lengthOfVariable; k++)
                    {
                        folderVariable.add(objectList[i].material, k.toString()).name(k == 0 ? "Smoothness" : k == 1 ? "Absorption" : k == 2 ? "Specular" : "Light").step(0.01).listen();
                    }

                    folderVariable.close();
                    break;

                default:
                    if (lengthOfVariable == 0)
                    {
                        folderVariable.add(objectList[i], variables[j]).step(0.01).listen();
                        folderVariable.close();
                        break;
                    }

                    for (let k = 0; k < lengthOfVariable; k++)
                    {
                        folderVariable.add(objectList[i][variables[j]], k.toString()).name(k == 0 ? "X" : k == 1 ? "Y" : k == 2 ? "Z" : "W").step(0.01).listen();
                    }

                    folderVariable.close();
                    break;
            }
        }

        folder.close();
    }
}

function refreshObjectsGUI(startIndex = 0, rebuild = false)
{
    if (rebuild)
    {
        objectsFolder.destroy();
        objectsFolder = gui.addFolder("Objects");
    }

    refreshObjectGUI(sphereTemplate, spheres, objectsFolder, null, startIndex);
    refreshObjectGUI(quadTemplate, quads, objectsFolder, null, startIndex);
    refreshObjectGUI(boxTemplate, boxes, objectsFolder, null, startIndex);
    refreshObjectGUI(meshTemplate, meshes, objectsFolder, null, startIndex, false);
}

function printCurrentScene()
{
    let funcString = "async function yourNewFunction() \n{\n";
    funcString += "\tlet spheres = [";

    for (let i = 0; i < spheres.length; i++)
    {
        funcString += `\n\t\tnew Sphere([${spheres[i].transform[0]}, ${spheres[i].transform[1]}, ${spheres[i].transform[2]}], [${spheres[i].color[0]}, ${spheres[i].color[1]}, ${spheres[i].color[2]}], ${spheres[i].transform[3]}, [${spheres[i].material[0]}, ${spheres[i].material[1]}, ${spheres[i].material[2]}, ${spheres[i].material[3]}]), `;
    }

    funcString += "\n\t];\n\n\tlet quads = [";

    for (let i = 0; i < quads.length; i++)
    {
        funcString += `\n\n\t\tnew Quad([${quads[i].Q[0]}, ${quads[i].Q[1]}, ${quads[i].Q[2]}, ${quads[i].Q[3]}], [${quads[i].U[0]}, ${quads[i].U[1]}, ${quads[i].U[2]}, ${quads[i].U[3]}], [${quads[i].V[0]}, ${quads[i].V[1]}, ${quads[i].V[2]}, ${quads[i].V[3]}], [${quads[i].color[0]}, ${quads[i].color[1]}, ${quads[i].color[2]}, ${quads[i].color[3]}], [${quads[i].material[0]}, ${quads[i].material[1]}, ${quads[i].material[2]}, ${quads[i].material[3]}]), `;
    }

    funcString += "\n\t];\n\n\tlet boxes = [";

    for (let i = 0; i < boxes.length; i++)
    {
        funcString += `\n\t\tnew Box([${boxes[i].center[0]}, ${boxes[i].center[1]}, ${boxes[i].center[2]}, ${boxes[i].center[3]}], [${boxes[i].color[0]}, ${boxes[i].color[1]}, ${boxes[i].color[2]}], [${boxes[i].rotation[0]}, ${boxes[i].rotation[1]}, ${boxes[i].rotation[2]}, ${boxes[i].rotation[3]}], [${boxes[i].radius[0]}, ${boxes[i].radius[1]}, ${boxes[i].radius[2]}, ${boxes[i].radius[3]}], [${boxes[i].material[0]}, ${boxes[i].material[1]}, ${boxes[i].material[2]}, ${boxes[i].material[3]}]), `;
    }

    funcString += "\n\t];\n";
    funcString += "\n\treturn {\n\t\tspheres : spheres,\n\t\tquads : quads,\n\t\tboxes : boxes,\n\t\ttriangles: [],\n\t\tmeshes: [],\n\t\tbackgroundColor1 : [" + backgroundColor1.object.r + ", " + backgroundColor1.object.g + ", " + backgroundColor1.object.b + "],\n\t\tbackgroundColor2 : [" + backgroundColor2.object.r + ", " + backgroundColor2.object.g + ", " + backgroundColor2.object.b + "],\n\t\tfocusDistance: " + uniforms.focusDistance + ",\n\t\tfocusAngle: " + uniforms.focusAngle + ",\n\t\tsunIntensity: " + uniforms.sunIntensity + ",\n\t\tsamplesPerPixel: " + uniforms.samplesPerPixel + ",\n\t\tmaxBounces: " + uniforms.maxBounces + "\n\t};";
    funcString += "\n}\n";
    console.log(funcString);
}

gui.onFinishChange( event => {});
gui.onChange( event => { handleAccumulate(false); writeBuffers();});
//!!!! LIL GUI IGNORE THIS

document.addEventListener("keydown", checkUserInput);
document.addEventListener("keyup", checkUserInput);

window.addEventListener("keydown", function(e) {
    if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.code) > -1) {
        e.preventDefault();
    }
}, false);

let rotQuat = quat.create();

function checkUserInput(event)
{
    let isKeyUp = event.type == "keyup";
    var velocity = cameraVelocityConstant;

    var setVel = (axis, event, value, originalVal) => {
        if (event.key == axis)
        {
            return isKeyUp ? 0.0 : value;
        }

        return originalVal;
    }

    cameraVelocity[0] = setVel("a", event, -velocity, cameraVelocity[0]);
    cameraVelocity[0] = setVel("d", event, velocity, cameraVelocity[0]);
    cameraVelocity[1] = setVel("q", event, -velocity, cameraVelocity[1]);
    cameraVelocity[1] = setVel("e", event, velocity, cameraVelocity[1]);
    cameraVelocity[2] = setVel("w", event, -velocity, cameraVelocity[2]);
    cameraVelocity[2] = setVel("s", event, velocity, cameraVelocity[2]);
    cameraRotationVelocity[2] = setVel("z", event, -velocity, cameraRotationVelocity[2]);
    cameraRotationVelocity[2] = setVel("x", event, velocity, cameraRotationVelocity[2]);
    cameraRotationVelocity[0] = setVel("ArrowLeft", event, -velocity, cameraRotationVelocity[0]);
    cameraRotationVelocity[0] = setVel("ArrowRight", event, velocity, cameraRotationVelocity[0]);
    cameraRotationVelocity[1] = setVel("ArrowDown", event, -velocity, cameraRotationVelocity[1]);
    cameraRotationVelocity[1] = setVel("ArrowUp", event, velocity, cameraRotationVelocity[1]);

    var sumMag = Math.abs(cameraVelocity[0]) + Math.abs(cameraVelocity[1]) + Math.abs(cameraVelocity[2]) + Math.abs(cameraRotationVelocity[0]) + Math.abs(cameraRotationVelocity[1]) + Math.abs(cameraRotationVelocity[2]);
    handleAccumulate(sumMag < 0.01, false);
}

function generateBackgroundColor(rgb1, rgb2)
{
    backgroundColor1.object = { r: rgb1[0], g: rgb1[1], b: rgb1[2] };
    backgroundColor2.object = { r: rgb2[0], g: rgb2[1], b: rgb2[2] };

    backgroundColor1.BGC1 = RGBToHex(rgb1[0] * 255, rgb1[1] * 255, rgb1[2] * 255);
    backgroundColor2.BGC2 = RGBToHex(rgb2[0] * 255, rgb2[1] * 255, rgb2[2] * 255);
}

function handleAccumulate(accumulate, timeAccumulate = true)
{
    uniforms.shouldAccumulate = accumulate ? 1 : 0;

    if (timeAccumulate)
    {
        timer(400, () => {
            handleAccumulate(!accumulate, false);
        });
    }
}

async function getScene(index)
{
    let bg1, bg2, focusDistance, focusAngle, sunIntensity, samplesPerPixel, maxBounces;
    ({spheres : spheres, quads : quads, boxes : boxes, 
        triangles: triangles, meshes: meshes, backgroundColor1 : bg1, 
        backgroundColor2 : bg2, focusDistance: focusDistance, focusAngle: 
        focusAngle, sunIntensity: sunIntensity, samplesPerPixel: samplesPerPixel, maxBounces: maxBounces} = await getAvailableScene(index, availableScenes));
    
    uniforms.focusDistance = focusDistance;
    uniforms.focusAngle = focusAngle;
    uniforms.sunIntensity = sunIntensity;
    uniforms.samplesPerPixel = samplesPerPixel;
    uniforms.maxBounces = maxBounces;

    generateBackgroundColor(bg1, bg2);
    writeBuffers();
    writeUniforms();
    refreshObjectsGUI(0, true);
    handleAccumulate(false);
}

function setup()
{
    getScene(0);
}

function writeUniforms()
{
    // uniforms
    // O contador representa apenas frames consecutivos acumulados. Ao mover a
    // camera ou alterar a cena, a acumulacao e reiniciada imediatamente.
    if (uniforms.shouldAccumulate > 0.5)
    {
        uniforms.frameCount++;
    }
    else
    {
        uniforms.frameCount = 0;
    }
    uniforms.sunColor = RGBToInt(sunColor.object.r * 255, sunColor.object.g * 255, sunColor.object.b * 255);
    uniforms.backgroundColor1 = RGBToInt(backgroundColor1.object.r * 255, backgroundColor1.object.g * 255, backgroundColor1.object.b * 255);
    uniforms.backgroundColor2 = RGBToInt(backgroundColor2.object.r * 255, backgroundColor2.object.g * 255, backgroundColor2.object.b * 255);
    
    uniforms.sphereCount = spheres.length;
    uniforms.quadCount = quads.length;
    uniforms.boxCount = boxes.length;
    uniforms.trianglesCount = triangles.length;
    uniforms.meshCount = meshes.length;
    
    var uniformData = new Float32Array(uniformsBufferSize / sizes.f32);
    var offset = 0;

    for (let key in uniforms)
    {
        uniformData[offset++] = uniforms[key];
    }

    gpu.queue.writeBuffer(uniformsBuffer, 0, uniformData);
}

function writeBuffer(buffer, size, objectList)
{
    if (objectList.length == 0)
    {
        return;
    }
    
    var objectData = new Float32Array(size / sizes.f32);
    var offset = 0;

    var variables = Object.keys(objectList[0]);
    for (let i = 0; i < objectList.length; i++)
    {
        for (let j = 1; j < variables.length; j++)
        {
            let lengthOfVariable = 0;
            if (typeof objectList[0][variables[j]] === 'object')
            {
                lengthOfVariable = objectList[0][variables[j]].length;
            }

            if (lengthOfVariable == 0)
            {
                objectData[offset++] = objectList[i][variables[j]];
                continue;
            }

            for (let k = 0; k < lengthOfVariable; k++)
            {
                objectData[offset++] = objectList[i][variables[j]][k];
            }
        }
    }

    gpu.queue.writeBuffer(buffer, 0, objectData);
}

// set the uniforms
function writeBuffers()
{
    // spheres
    writeBuffer(spheresBuffer, spheresBufferSize, spheres);

    // quads
    writeBuffer(quadsBuffer, quadsBufferSize, quads);

    // boxes
    writeBuffer(boxesBuffer, boxesBufferSize, boxes);

    // meshes
    writeBuffer(meshesBuffer, meshesBufferSize, meshes);

    // triangles
    writeBuffer(trianglesBuffer, trianglesBufferSize, triangles);
}

// render framebuffer to quad
function renderToScreen(encoder)
{
    var renderPass = encoder.beginRenderPass({
        colorAttachments: [
            {
                view: context.getCurrentTexture().createView(),
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear",
                storeOp: "store",
            },
        ],
    });

    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroupLayout);
    renderPass.draw(6, 1, 0, 0);
    renderPass.end();
}

// dispatch the compute render pass
function dispatchComputeRenderPass(pass)
{
    pass.setBindGroup(0, frameBuffersBindGroup);
    pass.setBindGroup(1, uniformsBindGroup);
    pass.setBindGroup(2, objectsBindGroup);

    pass.setPipeline(renderKernel);
    pass.dispatchWorkgroups(uniforms.rez / THREAD_COUNT, uniforms.rez / THREAD_COUNT, 1);

    pass.end();
}

function moveCamera(deltaTime)
{
    var rotatedCameraVelocity = vec3.create();
    vec3.transformQuat(rotatedCameraVelocity, cameraVelocity, rotQuat);

    var rotatedCameraRotationVelocity = vec3.create();
    vec3.transformQuat(rotatedCameraRotationVelocity, cameraRotationVelocity, rotQuat);

    uniforms.camerax += rotatedCameraVelocity[0] * deltaTime;
    uniforms.cameray += rotatedCameraVelocity[1] * deltaTime;
    uniforms.cameraz += rotatedCameraVelocity[2] * deltaTime;

    uniforms.lookatx += rotatedCameraRotationVelocity[0] * deltaTime;
    uniforms.lookaty += rotatedCameraRotationVelocity[1] * deltaTime;
    uniforms.lookatz += rotatedCameraRotationVelocity[2] * deltaTime;

    var rotMatrix = mat4.create();
    mat4.targetTo(rotMatrix, [uniforms.camerax, uniforms.cameray, uniforms.cameraz], [uniforms.lookatx, uniforms.lookaty, uniforms.lookatz], [0, 1, 0]);
    mat4.getRotation(rotQuat, rotMatrix);
}

// update and render
async function update()
{
    let startms = performance.now();

    // begin the compute pass
    const encoder = gpu.createCommandEncoder();
    const pass = encoder.beginComputePass();

    // set the uniforms
    writeUniforms();

    // render the scene
    dispatchComputeRenderPass(pass);
    renderToScreen(encoder);

    // end the compute pass
    gpu.queue.submit([encoder.finish()]);
    await gpu.queue.onSubmittedWorkDone();

    // get fps
    perfCount ++;
    let elapsedms = (performance.now() - startms);
    
    if (perfCount == 60)
    {
        performanceStats.ms = elapsedms.toFixed(2);
        performanceStats.fps = (1 / elapsedms * 1000).toFixed(0);
        perfCount = 0;
    }

    moveCamera(elapsedms / 1000);
    window.requestAnimationFrame(update, 0);
};

setup();
update();
