import * as THREE from 'three';

// Work in raw sRGB values end-to-end so procedural pixel colours render exactly as painted.
THREE.ColorManagement.enabled = false;
