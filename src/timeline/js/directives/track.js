/**
 * @file
 * @brief Track directives (droppable functionality, etc...)
 * @author Jonathan Thomas <jonathan@openshot.org>
 * @author Cody Parker <cody@yourcodepro.com>
 *
 * @section LICENSE
 *
 * Copyright (c) 2008-2018 OpenShot Studios, LLC
 * <http://www.openshotstudios.com/>. This file is part of
 * OpenShot Video Editor, an open-source project dedicated to
 * delivering high quality video editing and animation solutions to the
 * world. For more information visit <http://www.openshot.org/>.
 *
 * OpenShot Video Editor is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * OpenShot Video Editor is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with OpenShot Library.  If not, see <http://www.gnu.org/licenses/>.
 */


// Treats element as a track
// 1: allows clips, transitions, and effects to be dropped
/*global App, timeline, findTrackAtLocation*/
App.directive("tlTrack", function ($timeout) {
  return {
    // A = attribute, E = Element, C = Class and M = HTML Comment
    restrict: "A",
    link: function (scope, element, attrs) {

      scope.$watch("project.layers.length", function (val) {
        if (val) {
          $timeout(function () {
            // Update track indexes if tracks change
            scope.updateLayerIndex();
            scope.playhead_height = $("#track-container").height();
            $(".playhead-line").height(scope.playhead_height);
          }, 0);

        }
      });

      //make it accept drops
      element.droppable({
        accept: ".droppable",
        drop: function (event, ui) {

          // Disabling sorting (until all the updates are completed)
          scope.enable_sorting = false;

          var scrolling_tracks = $("#scrolling_tracks");
          var vert_scroll_offset = scrolling_tracks.scrollTop();
          var horz_scroll_offset = scrolling_tracks.scrollLeft();

          // Keep track of each dropped clip (to check for missing transitions below, after they have been dropped)
          var dropped_clips = [];
          var position_diff = 0; // the time diff to apply to multiple selections (if any)
          var ui_selected = $(".ui-selected");
          var selected_item_count = ui_selected.length;

          // Arrays to collect updates for batch processing
          var clip_updates = [];
          var transition_updates = [];

          // Get uuid to group all these updates as a single transaction
          var tid = uuidv4();
          var drop_track_num = -1;

          // with each dragged clip, find out which track they landed on
          // Loop through each selected item, and remove the selection if multiple items are selected
          // If only 1 item is selected, leave it selected
          ui_selected.each(function (index) {
            var item = $(this);

            // Determine type of item
            var item_type = null;
            if (item.hasClass("clip")) {
              item_type = "clip";
            } else if (item.hasClass("transition")) {
              item_type = "transition";
            } else {
              // Unknown drop type
              return;
            }

            // get the item properties we need
            var item_id = item.attr("id");
            var item_num = item_id.substr(item_id.indexOf("_") + 1);
            var item_left = item.position().left;

            // Adjust top and left coordinates for scrollbars
            item_left = parseFloat(item_left + horz_scroll_offset);
            var item_top = parseFloat(item.position().top + vert_scroll_offset);

            // make sure the item isn't dropped off too far to the left
            if (item_left < 0) {
              item_left = 0;
            }

            // get track the item was dropped on
            let drop_track = findTrackAtLocation(scope, parseInt(item_top, 10));
            if (drop_track != null) {
              // find the item in the json data
              let item_data = null;
              if (item_type === "clip") {
                item_data = findElement(scope.project.clips, "id", item_num);
              } else if (item_type === "transition") {
                item_data = findElement(scope.project.effects, "id", item_num);
              }

              // set time diff (if not already determined)
              if (position_diff === 0.0) {
                // once calculated, we want to apply the exact same time diff to each clip/trans
                position_diff = (item_left / scope.pixelsPerSecond) - item_data.position;
              }

              scope.$apply(function () {
                //set track and position
                item_data.layer = drop_track.number;
                item_data.position += position_diff;
              });
              scope.$apply(function () {
                // Snap to FPS grid (must be done separately so Angular will actually refresh
                // when extreme zooms are used (i.e. you drag a clip a partial frame, this causes it
                // to jump back to it's original position correctly).
                item_data.position = snapToFPSGridTime(scope, item_data.position);
              });

              // Resize timeline if it's too small to contain all clips
              scope.resizeTimeline();

              // Keep track of dropped clips (we'll check for missing transitions in a sec)
              dropped_clips.push(item_data);

              // Collect updates for later batch processing
              if (item_type === "clip") {
                clip_updates.push(item_data);
              } else if (item_type === "transition") {
                transition_updates.push(item_data);
              }
            }
          });

          // Now fire all the Qt updates after all scope.$apply calls
          // Update clips in Qt
          clip_updates.forEach(function(item_data, index) {
            var needs_refresh = (index === clip_updates.length - 1);
            timeline.update_clip_data(JSON.stringify(item_data), true, true, !needs_refresh, tid);
          });

          // Update transitions in Qt
          transition_updates.forEach(function(item_data, index) {
            var needs_refresh = (index === transition_updates.length - 1);
            timeline.update_transition_data(JSON.stringify(item_data), true, !needs_refresh, tid);
          });

          // Add missing transitions (if any)
          if (dropped_clips.length === 1) {
            // Hack to only add missing transitions if a single clip is being dropped
            for (var clip_index = 0; clip_index < dropped_clips.length; clip_index++) {
              var item_data = dropped_clips[clip_index];

              // Check again for missing transitions
              var missing_transition_details = scope.getMissingTransitions(item_data);
              if (scope.Qt && missing_transition_details !== null) {
                timeline.add_missing_transition(JSON.stringify(missing_transition_details));
              }
            }
          }

          // Clear dropped clips
          dropped_clips = [];

          // Re-sort clips
          scope.enable_sorting = true;
          scope.sortItems();
        }
      });
    }
  };
});
