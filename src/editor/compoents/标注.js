import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// 导出组件定义
export default {
    name: '标注',
    label: '标注',

    // 创建组件
    create: function (storage, { transformControls }) {
        // 初始参数
        const params = {
            text: storage?.text || '设备' + Math.floor(Math.random() * 1000), // 默认文本，随机编号
            fontSize: storage?.fontSize || '18px',
            color: storage?.color || '#bedfff',
            bold: storage?.bold || 'normal',
            status: storage?.status || '在线',
            deviceNo: storage?.deviceNo || ('DEV-' + Math.floor(Math.random() * 9000 + 1000)),
            location: storage?.location || 'A区机房',
            owner: storage?.owner || '运维组',
            imgSrc: storage?.imgSrc || 'https://z2586300277.github.io/three-cesium-examples/files/author/z2586300277.png'
        };
        
        // 创建根容器
        const container = document.createElement("div");
        container.style.position = "relative";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";
        container.style.justifyContent = "center";
        container.style.textAlign = "center";
        container.style.gap = "6px";
        
        // 简单2D标注：上方文字，下方图片
        container.innerHTML = `
            <div id="textDisplay" style="text-align:center; pointer-events:auto; cursor:pointer; user-select:none;">
                <span id="textSpan" style="font-size:${params.fontSize}; color:${params.color}; font-weight:${params.bold};">
                    ${params.text}
                </span>
            </div>

            <div id="imgContainer" style="pointer-events:auto; width:40px; height:40px; cursor:pointer; display:flex; justify-content:center; align-items:center; margin:0 auto;">
                <img src="${params.imgSrc}" style="width:100%; height:100%; object-fit:scale-down; display:block; margin:0 auto;">
            </div>

            <div id="devicePopup" style="position:absolute; left:50%; bottom:52px; transform:translate(-50%, 0px); width:216px; padding:10px 12px; border-radius:12px; background:linear-gradient(145deg, rgba(15, 30, 52, 0.96), rgba(8, 14, 25, 0.95)); border:1px solid rgba(118, 182, 255, 0.45); box-shadow:0 12px 26px rgba(0, 0, 0, 0.38), inset 0 0 16px rgba(93, 169, 255, 0.15); backdrop-filter:blur(6px); text-align:left; color:#e6f3ff; pointer-events:auto; z-index:10; display:none; opacity:0; transition:opacity .18s ease, transform .18s ease;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                    <span style="font-size:13px; font-weight:700; color:#9fd4ff;">设备信息</span>
                    <button id="popupClose" style="pointer-events:auto; border:none; background:transparent; color:#bcdfff; font-size:14px; cursor:pointer; padding:0 2px;">✕</button>
                </div>
                <div style="display:grid; grid-template-columns:54px 1fr; row-gap:4px; column-gap:6px; font-size:12px; line-height:1.35;">
                    <span style="color:#8caed0;">名称</span><span id="popupName" style="color:#ffffff;"></span>
                    <span style="color:#8caed0;">编号</span><span id="popupNo" style="color:#d7ecff;">${params.deviceNo}</span>
                    <span style="color:#8caed0;">状态</span><span id="popupStatus" style="color:#79f2ad;">${params.status}</span>
                    <span style="color:#8caed0;">位置</span><span id="popupLocation" style="color:#d7ecff;">${params.location}</span>
                    <span style="color:#8caed0;">负责人</span><span id="popupOwner" style="color:#d7ecff;">${params.owner}</span>
                </div>
                <div style="position:absolute; left:50%; bottom:-6px; width:12px; height:12px; transform:translateX(-50%) rotate(45deg); background:rgba(9, 16, 28, 0.95); border-right:1px solid rgba(118, 182, 255, 0.45); border-bottom:1px solid rgba(118, 182, 255, 0.45);"></div>
            </div>
        `;
        
        // 获取DOM元素引用
        const textDisplay = container.querySelector('#textDisplay');
        const textSpan = container.querySelector('#textSpan');
        const imgContainer = container.querySelector('#imgContainer');
        const devicePopup = container.querySelector('#devicePopup');
        const popupName = container.querySelector('#popupName');
        const popupStatus = container.querySelector('#popupStatus');
        const popupClose = container.querySelector('#popupClose');
        
        // 构建CSS2D对象
        const mesh = new CSS2DObject(container);

        // 文本与 mesh.name 同步
        mesh.name = String(storage?.name || params.text);
        params.text = mesh.name;
        textSpan.textContent = mesh.name;
        
        // 存储参数
        mesh.userData.params = params;

        let popupVisible = false;
        let clickTimer = null;

        const showPopup = () => {
            const name = String(mesh.name || params.text);
            params.text = name;
            textSpan.textContent = name;
            popupName.textContent = name;
            popupStatus.textContent = params.status;
            popupVisible = true;
            devicePopup.style.display = 'block';
            requestAnimationFrame(() => {
                devicePopup.style.opacity = '1';
                devicePopup.style.transform = 'translate(-50%, -8px)';
            });
        };

        const hidePopup = () => {
            popupVisible = false;
            devicePopup.style.opacity = '0';
            devicePopup.style.transform = 'translate(-50%, 0px)';
            setTimeout(() => {
                if (!popupVisible) {
                    devicePopup.style.display = 'none';
                }
            }, 180);
        };

        const bindMarkerEvents = target => {
            target.addEventListener('click', event => {
                event.stopPropagation();
                if (clickTimer) {
                    clearTimeout(clickTimer);
                }
                clickTimer = setTimeout(() => {
                    showPopup();
                    clickTimer = null;
                }, 220);
            });

            target.addEventListener('dblclick', event => {
                event.stopPropagation();
                if (clickTimer) {
                    clearTimeout(clickTimer);
                    clickTimer = null;
                }
                hidePopup();
                transformControls?.attach?.(mesh);
            });
        };
        
        bindMarkerEvents(textDisplay);
        bindMarkerEvents(imgContainer);

        popupClose.addEventListener('click', event => {
            event.stopPropagation();
            hidePopup();
        });
        
        return mesh;
    },
    
    // 获取存储数据
    getStorage: function(mesh) {
        const params = mesh.userData.params || {};
        return { ...params, text: mesh.name || params.text };
    },
};
