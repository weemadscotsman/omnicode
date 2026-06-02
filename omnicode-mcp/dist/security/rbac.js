"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkPermission = checkPermission;
const ROLE_PERMISSIONS = {
    'admin': ['*'],
    'read-only': [
        'health_check',
        'list_tools',
        'get_tool_schema',
        'invoke_tool',
        'session_resume_brief',
        'search_symbols',
        'get_symbol',
        'get_file_slice',
        'get_file_context',
        'file_outline',
        'repo_map',
        'route_map',
        'test_map',
        'config_map',
        'dependency_map',
        'blast_radius',
        'dead_code_scan',
        'spaghetti_report',
        'blindspot_report',
        'get_context_bundle',
        'find_references',
        'get_hotspots',
        'get_churn_rate',
        'get_call_hierarchy',
        'language_support',
        'get_session_stats',
        'token_savings_stats',
        'runtime_telemetry',
        'benchmark',
        'repair_plan',
        'write_repair_handoff'
    ],
    'agent': [
        'health_check',
        'list_tools',
        'get_tool_schema',
        'invoke_tool',
        'session_resume_brief',
        'index_project',
        'search_symbols',
        'get_symbol',
        'get_file_slice',
        'get_file_context',
        'file_outline',
        'repo_map',
        'route_map',
        'test_map',
        'config_map',
        'dependency_map',
        'blast_radius',
        'dead_code_scan',
        'spaghetti_report',
        'blindspot_report',
        'get_context_bundle',
        'plan_turn',
        'check_rename_safe',
        'find_references',
        'check_delete_safe',
        'get_hotspots',
        'get_churn_rate',
        'get_call_hierarchy',
        'language_support',
        'get_session_stats',
        'token_savings_stats',
        'runtime_telemetry',
        'benchmark',
        'clone_and_index',
        'repair_plan',
        'write_repair_handoff'
    ]
};
function checkPermission(role, toolName) {
    const allowedTools = ROLE_PERMISSIONS[role] || [];
    if (allowedTools.includes('*'))
        return true;
    return allowedTools.includes(toolName);
}
