import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ProjectionGenerator } from '@antoninrousset/three-edge-projection';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

export default {
    name: '模型投影',
    label: '模型投影',
    async create(storage, { scene, transformControls }) {
        const projectionGroup = new THREE.Group();
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
        const lastSourceMatrix = new THREE.Matrix4();
        const sourceBox = new THREE.Box3();
        const sourceCenter = new THREE.Vector3();
        const sourceSize = new THREE.Vector3();
        const centerOffsetMatrix = new THREE.Matrix4();

        let sourceObject = getSelectedSource(transformControls);
        let projectionLines = null;
        let generating = false;
        let pending = false;
        let disposed = false;

        if (!sourceObject) {
            sourceObject = await loadDemoModel();
            const modelBox = new THREE.Box3().setFromObject(sourceObject);
            const modelCenter = modelBox.getCenter(new THREE.Vector3());
            const modelSize = modelBox.getSize(new THREE.Vector3());
            const spacing = Math.max(modelSize.x, modelSize.z, 1) * 1.4;

            sourceObject.position.sub(modelCenter);
            sourceObject.position.x -= spacing * 0.5;
            sourceObject.name = 'Source Model';
            scene.add(sourceObject);
        }

        projectionGroup.name = 'Projected Model';
        projectionGroup.userData.sourceProjectionTargetId = sourceObject.id;
        transformControls?.addEventListener?.('object-changed', syncSourceFromTransformControls);
        transformControls?.addEventListener?.('objectChange', handleTransformObjectChange);

        function getSelectedSource(transformControls) {
            const object = transformControls?.object;
            if (!object || object.isTransformControls || object.isHelper || object.type?.includes('Helper')) return null;
            if (object.designType === '模型投影') return null;
            return hasMesh(object) ? object : null;
        }

        function hasMesh(object) {
            let result = false;
            object.traverse((child) => {
                if (child.isMesh) result = true;
            });
            return result;
        }

        async function loadDemoModel() {
            const loader = new GLTFLoader();
            const dracoLoader = new DRACOLoader();
            dracoLoader.setDecoderPath('https://z2586300277.github.io/three-editor/dist/draco/')
            loader.setDRACOLoader(dracoLoader);
            const gltf = await loader.loadAsync('https://z2586300277.github.io/three-editor/dist/files/resource/datacenter.glb');
            return gltf.scene;
        }

        function updateProjectionPlacement() {
            sourceBox.setFromObject(sourceObject);
            sourceBox.getCenter(sourceCenter);
            sourceBox.getSize(sourceSize);

            const spacing = Math.max(sourceSize.x, sourceSize.z, 1) * 1.4;
            projectionGroup.position.set(sourceCenter.x + spacing, sourceCenter.y, sourceCenter.z);
            centerOffsetMatrix.makeTranslation(-sourceCenter.x, -sourceCenter.y, -sourceCenter.z);
        }

        function createMergedGeometry() {
            const geometries = [];

            sourceObject.updateMatrixWorld(true);
            updateProjectionPlacement();

            sourceObject.traverse((child) => {
                if (!child.isMesh) return;

                const geometry = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
                geometry.applyMatrix4(child.matrixWorld);
                geometry.applyMatrix4(centerOffsetMatrix);

                const mergedPart = new THREE.BufferGeometry();
                mergedPart.setAttribute('position', geometry.getAttribute('position').clone());
                geometries.push(mergedPart);
                geometry.dispose();
            });

            if (!geometries.length) return null;

            const mergedGeometry = mergeGeometries(geometries);
            geometries.forEach((geometry) => geometry.dispose());
            return mergedGeometry;
        }

        async function updateProjection() {
            if (generating) {
                pending = true;
                return;
            }

            generating = true;
            pending = false;

            const mergedGeometry = createMergedGeometry();
            if (!mergedGeometry) {
                generating = false;
                return;
            }

            const projectionGeometry = await new ProjectionGenerator().generateAsync(mergedGeometry);
            mergedGeometry.dispose();

            if (disposed) {
                projectionGeometry.dispose();
                generating = false;
                return;
            }

            const lines = new THREE.LineSegments(projectionGeometry, lineMaterial);
            lines.position.y = 0.01;

            if (projectionLines) {
                projectionGroup.remove(projectionLines);
                projectionLines.geometry.dispose();
            }

            projectionLines = lines;
            projectionGroup.add(lines);
            generating = false;

            if (pending) {
                updateProjection();
            }
        }

        function setSourceObject(object) {
            if (!object || object === sourceObject) return false;

            sourceObject = object;
            projectionGroup.userData.sourceProjectionTargetId = sourceObject.id;
            sourceObject.updateMatrixWorld(true);
            lastSourceMatrix.copy(sourceObject.matrixWorld);
            updateProjection();
            return true;
        }

        function syncSourceFromTransformControls() {
            setSourceObject(getSelectedSource(transformControls));
        }

        function handleTransformObjectChange() {
            if (disposed || transformControls?.object !== sourceObject) return;

            sourceObject.updateMatrixWorld(true);
            lastSourceMatrix.copy(sourceObject.matrixWorld);
            updateProjection();
        }

        await updateProjection();
        sourceObject.updateMatrixWorld(true);
        lastSourceMatrix.copy(sourceObject.matrixWorld);

        scene.addUpdateListener(() => {
            if (disposed) return;

            syncSourceFromTransformControls();
            if (!sourceObject.parent) return;

            sourceObject.updateMatrixWorld(true);
            if (lastSourceMatrix.equals(sourceObject.matrixWorld)) return;

            lastSourceMatrix.copy(sourceObject.matrixWorld);
            updateProjection();
        });

        projectionGroup.userData.dispose = () => {
            disposed = true;
            transformControls?.removeEventListener?.('object-changed', syncSourceFromTransformControls);
            transformControls?.removeEventListener?.('objectChange', handleTransformObjectChange);
            projectionLines?.geometry.dispose();
            lineMaterial.dispose();
        };

        setTimeout(() => transformControls?.attach?.(sourceObject));
        return projectionGroup;
    }
};
