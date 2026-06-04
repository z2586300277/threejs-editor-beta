import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ProjectionGenerator } from '@antoninrousset/three-edge-projection';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export default {
    name: '模型投影',
    label: '模型投影',
    async create(storage, { scene }) {
        const loader = new GLTFLoader();
        const dracoLoader = new DRACOLoader();
        dracoLoader.setDecoderPath('https://z2586300277.github.io/three-editor/dist/draco/')
        loader.setDRACOLoader(dracoLoader);
        const gltf = await loader.loadAsync('https://z2586300277.github.io/three-editor/dist/files/resource/datacenter.glb');
        const model = gltf.scene;
        const group = new THREE.Group();
        const geometries = [];

        model.updateMatrixWorld(true);
        model.traverse((child) => {
            if (!child.isMesh) return;

            const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
            geometry.applyMatrix4(child.matrixWorld);

            const mergedPart = new THREE.BufferGeometry();
            mergedPart.setAttribute('position', geometry.getAttribute('position').clone());
            geometries.push(mergedPart);
        });

        const mergedGeometry = mergeGeometries(geometries);
        const projectionGeometry = await new ProjectionGenerator().generateAsync(mergedGeometry);
        const lines = new THREE.LineSegments(
            projectionGeometry,
            new THREE.LineBasicMaterial({ color: 0x00000 })
        );

        lines.position.y = 0.01;
        // group.add(model);
        group.add(lines);

        return group;
    }
};
